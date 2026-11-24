import { describe, expect, it } from 'vitest';
import { extractFromHtml, extractFromStructured, parsePrice } from '../../src/modules/retail/extract.ts';
import { inferSubcategory, inferMaterials } from '../../src/modules/retail/categorize.ts';
import { retailerForHost } from '../../src/modules/retail/registry.ts';

// Synthetic fixtures written for these tests (not copied from any retailer).
const productGroup = {
  '@context': 'https://schema.org',
  '@type': 'ProductGroup',
  name: 'Chaqueta acolchada con capucha',
  brand: { '@type': 'Brand', name: 'Marca Ejemplo' },
  color: 'Azul marino',
  image: ['https://cdn.example.test/a.jpg', { '@type': 'ImageObject', url: 'https://cdn.example.test/b.jpg' }],
  hasVariant: [
    { '@type': 'Product', sku: 'X-S', size: 'S', offers: { '@type': 'Offer', price: '49.95', priceCurrency: 'EUR', availability: 'https://schema.org/InStock' } },
    { '@type': 'Product', sku: 'X-M', size: 'M', offers: { '@type': 'Offer', price: '49.95', priceCurrency: 'EUR', availability: 'https://schema.org/OutOfStock', priceSpecification: { '@type': 'UnitPriceSpecification', priceType: 'https://schema.org/StrikethroughPrice', price: 69.95 } } },
  ],
};

describe('structured data extraction', () => {
  it('reads ProductGroup variants, prices, sale price and availability', () => {
    const p = extractFromStructured({ jsonLd: [JSON.stringify(productGroup)], meta: {}, title: null, baseUrl: 'https://shop.example.test/p/1' });
    expect(p.title?.value).toBe('Chaqueta acolchada con capucha');
    expect(p.brand?.value).toBe('Marca Ejemplo');
    expect(p.price?.value).toEqual({ cents: 4995, currency: 'EUR' });
    expect(p.originalPrice?.value.cents).toBe(6995);
    expect(p.availability?.value).toBe('in_stock');
    expect(p.sizes?.value).toEqual(['S', 'M']);
    expect(p.variants.find((v) => v.size === 'M')?.available).toBe(false);
    expect(p.images?.value).toHaveLength(2);
    expect(p.title?.source).toBe('json_ld');
  });
  it('handles @graph, AggregateOffer and HTML-embedded blocks', () => {
    const html = `<html><head><title>T</title><link rel="canonical" href="/es/p/9"><script type="application/ld+json">{"@graph":[{"@type":"WebPage"},{"@type":"Product","name":"Vaquero recto","offers":{"@type":"AggregateOffer","lowPrice":"29,99","priceCurrency":"EUR"}}]}</script></head><body></body></html>`;
    const p = extractFromHtml(html, 'https://shop.example.test/es/p/9?x=1');
    expect(p.title?.value).toBe('Vaquero recto');
    expect(p.price?.value.cents).toBe(2999);
    expect(p.canonicalUrl).toBe('https://shop.example.test/es/p/9');
  });
  it('uses microdata when there is no JSON-LD (e.g. Mango-style pages)', () => {
    const html = `<div itemscope itemtype="https://schema.org/Product"><h1 itemprop="name">Abrigo lana cruzado</h1><meta itemprop="price" content="119.99"><meta itemprop="priceCurrency" content="EUR"><link itemprop="availability" href="https://schema.org/InStock"><img itemprop="image" src="https://cdn.example.test/x.jpg"></div>`;
    const p = extractFromHtml(html, 'https://shop.example.test/x');
    expect(p.title).toEqual({ value: 'Abrigo lana cruzado', source: 'microdata' });
    expect(p.price?.value.cents).toBe(11999);
    expect(p.availability?.value).toBe('in_stock');
  });
  it('never accepts a zero OpenGraph price placeholder', () => {
    const p = extractFromStructured({ jsonLd: [], meta: { 'og:title': 'Camisa', 'og:price:amount': '0.0', 'og:price:currency': 'EUR' }, title: null, baseUrl: 'https://x.test' });
    expect(p.price).toBeNull();
    expect(p.title?.source).toBe('open_graph');
  });
  it('detects anti-bot walls instead of treating them as products', () => {
    const p = extractFromHtml('<html><title>Access Denied</title><body>Please verify you are human</body></html>', 'https://x.test');
    expect(p.looksBlocked).toBe(true);
  });
  it('parses Spanish and English price formats', () => {
    expect(parsePrice('1.299,95 €')).toBe(129995);
    expect(parsePrice('1,299.95')).toBe(129995);
    expect(parsePrice('29,95')).toBe(2995);
    expect(parsePrice(49)).toBe(4900);
    expect(parsePrice('gratis')).toBeNull();
  });
});

describe('category and retailer inference', () => {
  it.each([
    ['Cazadora vaquera oversize', 'cazadora_vaquera'],
    ['Pantalón jogger tailoring', 'jogger'],
    ['Pantalones negros', 'pantalon'],
    ['Gabardina satinada capucha desmontable', 'gabardina'],
    ['Zapatillas running Kiprun', 'zapatillas_running'],
    ['Chaqueta softshell capucha', 'chaqueta'],
    ['Abrigo lana cruzado botones', 'abrigo'],
    ['Botín plano chelsea', 'botines'],
  ])('%s → %s', (title, sub) => {
    expect(inferSubcategory(title)?.subcategory).toBe(sub);
  });
  it('infers materials conservatively', () => {
    expect(inferMaterials('Jersey 100% lana merino')).toEqual(['lana']);
  });
  it('resolves retailers by domain', () => {
    expect(retailerForHost('www.zara.com')?.id).toBe('zara');
    expect(retailerForHost('shop.mango.com')?.id).toBe('mango');
    expect(retailerForHost('www2.hm.com')?.id).toBe('hm');
    expect(retailerForHost('zara.com.evil.test')).toBeNull();
  });
});
