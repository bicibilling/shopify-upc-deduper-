require('dotenv').config();
const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

const {
  SHOPIFY_STORE,
  SHOPIFY_CLIENT_ID,
  SHOPIFY_CLIENT_SECRET,
  REDIRECT_URI,
  PORT = 3000
} = process.env;

const TOKEN_FILE = path.join(__dirname, '.token.json');
const redirectUri = REDIRECT_URI || `http://localhost:${PORT}/auth/callback`;
const SCOPES = 'read_products,write_products';

// Load saved token if it exists
let accessToken = null;
if (fs.existsSync(TOKEN_FILE)) {
  try {
    accessToken = JSON.parse(fs.readFileSync(TOKEN_FILE)).token;
    console.log('Loaded saved access token.');
  } catch {}
}

function shopifyApi() {
  return axios.create({
    baseURL: `https://${SHOPIFY_STORE}/admin/api/2024-01`,
    headers: { 'X-Shopify-Access-Token': accessToken }
  });
}

// ── Auth ──────────────────────────────────────────────────────────────────────

app.get('/auth', (req, res) => {
  const state = crypto.randomBytes(16).toString('hex');
  const url =
    `https://${SHOPIFY_STORE}/admin/oauth/authorize` +
    `?client_id=${SHOPIFY_CLIENT_ID}` +
    `&scope=${SCOPES}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&state=${state}`;
  res.redirect(url);
});

app.get('/auth/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).send('Missing code');

  try {
    const response = await axios.post(
      `https://${SHOPIFY_STORE}/admin/oauth/access_token`,
      {
        client_id: SHOPIFY_CLIENT_ID,
        client_secret: SHOPIFY_CLIENT_SECRET,
        code
      }
    );
    accessToken = response.data.access_token;
    fs.writeFileSync(TOKEN_FILE, JSON.stringify({ token: accessToken }));
    console.log('Access token saved.');
    res.redirect('/');
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).send('OAuth failed: ' + JSON.stringify(err.response?.data || err.message));
  }
});

// ── API ───────────────────────────────────────────────────────────────────────

function requireAuth(req, res, next) {
  if (!accessToken) {
    return res.status(401).json({ error: 'Not authenticated', authUrl: '/auth' });
  }
  next();
}

async function getAllProducts() {
  const api = shopifyApi();
  let products = [];
  let url = '/products.json?limit=250&fields=id,title,variants,images';

  while (url) {
    const response = await api.get(url);
    products = products.concat(response.data.products);

    const link = response.headers['link'];
    url = null;
    if (link) {
      const match = link.match(/<([^>]+)>;\s*rel="next"/);
      if (match) {
        url = match[1].replace(`https://${SHOPIFY_STORE}/admin/api/2024-01`, '');
      }
    }
  }

  return products;
}

app.get('/api/status', (req, res) => {
  res.json({ authenticated: !!accessToken, authUrl: '/auth' });
});

app.get('/api/duplicates', requireAuth, async (req, res) => {
  try {
    const products = await getAllProducts();
    const barcodeMap = {};

    for (const product of products) {
      for (const variant of product.variants) {
        const barcode = variant.barcode?.trim();
        if (!barcode) continue;

        if (!barcodeMap[barcode]) barcodeMap[barcode] = [];

        let imageUrl = null;
        if (variant.image_id) {
          const img = product.images.find(i => i.id === variant.image_id);
          if (img) imageUrl = img.src;
        }
        if (!imageUrl && product.images.length > 0) {
          imageUrl = product.images[0].src;
        }

        barcodeMap[barcode].push({
          barcode,
          productId: product.id,
          productTitle: product.title,
          variantId: variant.id,
          variantTitle: variant.title,
          sku: variant.sku || null,
          price: variant.price,
          imageUrl,
          isOnlyVariant: product.variants.length === 1
        });
      }
    }

    const duplicates = Object.entries(barcodeMap)
      .filter(([, variants]) => variants.length > 1)
      .filter(([, variants]) => variants.some(v => v.sku && v.sku.includes('-')))
      .map(([barcode, variants]) => ({ barcode, variants }))
      .sort((a, b) => a.barcode.localeCompare(b.barcode));

    res.json({ duplicates, totalProducts: products.length });
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/variants/:productId/:variantId', requireAuth, async (req, res) => {
  const { productId, variantId } = req.params;
  const onlyVariant = req.query.onlyVariant === '1';
  console.log(`DELETE request: productId=${productId} variantId=${variantId} onlyVariant=${onlyVariant}`);
  try {
    if (onlyVariant) {
      const response = await shopifyApi().delete(`/products/${productId}.json`);
      console.log(`DELETE product success: status=${response.status}`);
      res.json({ success: true, deletedProduct: true });
    } else {
      const response = await shopifyApi().delete(`/products/${productId}/variants/${variantId}.json`);
      console.log(`DELETE variant success: status=${response.status}`);
      res.json({ success: true });
    }
  } catch (err) {
    console.error('DELETE failed:', err.response?.data || err.message);
    res.status(500).json({ error: err.response?.data?.errors || err.message });
  }
});

app.use(express.static('public'));

app.listen(PORT, () => {
  console.log(`Running at http://localhost:${PORT}`);
  if (!accessToken) {
    console.log(`Not authenticated — visit http://localhost:${PORT}/auth to connect Shopify`);
  }
});
