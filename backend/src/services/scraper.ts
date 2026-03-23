import axios from 'axios';
import * as cheerio from 'cheerio';
import crypto from 'crypto';
import { db } from '../db/client';
import { cacheGet, cacheSet } from '../cache/redis';
import { uploadFile, generateAttachmentKey } from '../services/r2';

// Supported e-commerce domains
const SUPPORTED_DOMAINS = [
  'tokopedia.com',
  'shopee.co.id',
  'shopee.com',
  'bukalapak.com',
  'lazada.co.id',
  'blibli.com',
];

// Cache TTL: 7 days
const CACHE_TTL = 7 * 24 * 60 * 60;

export interface ScrapedProduct {
  success: true;
  data: {
    name: string;
    price: number;
    description?: string;
    imageUrl: string;
    originalImageUrl: string;
    source: string;
    currency: string;
    url: string;
  };
  imageError?: string;
}

export interface ScrapeError {
  success: false;
  error: 'unsupported_domain' | 'scraping_failed' | 'invalid_url' | 'image_download_failed';
  message: string;
}

function getCacheKey(url: string): string {
  return `scrape:${crypto.createHash('md5').update(url).digest('hex')}`;
}

function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function getDomain(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function isSupportedDomain(url: string): boolean {
  const domain = getDomain(url);
  return SUPPORTED_DOMAINS.some(supported => domain.includes(supported));
}

async function downloadImage(imageUrl: string): Promise<Buffer | null> {
  try {
    const response = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
      timeout: 10000,
      maxRedirects: 5,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    });
    
    // Validate it's an image
    const contentType = response.headers['content-type'];
    if (!contentType || !contentType.startsWith('image/')) {
      console.warn('Downloaded content is not an image:', contentType);
      return null;
    }
    
    // Check size (max 5MB)
    const size = response.data.length;
    if (size > 5 * 1024 * 1024) {
      console.warn('Image too large:', size);
      return null;
    }
    
    return Buffer.from(response.data);
  } catch (err) {
    console.error('Failed to download image:', err);
    return null;
  }
}

async function uploadImageToR2(imageBuffer: Buffer, originalUrl: string): Promise<string | null> {
  try {
    // Generate a unique key for the image
    const timestamp = Date.now();
    const hash = crypto.createHash('md5').update(originalUrl).digest('hex').substring(0, 8);
    const key = `wishlist-images/${timestamp}_${hash}.jpg`;
    
    await uploadFile(key, imageBuffer, 'image/jpeg');
    
    return key;
  } catch (err) {
    console.error('Failed to upload image to R2:', err);
    return null;
  }
}

// Parse Indonesian price format (e.g., "Rp 1.299.000" -> 1299000)
function parsePrice(priceText: string): number | null {
  if (!priceText) return null;
  
  // Remove currency symbols and non-numeric characters except dots
  const cleaned = priceText
    .replace(/[^\d.,]/g, '')
    .replace(/\./g, '') // Remove thousand separators
    .replace(/,/g, '.'); // Convert decimal comma to dot
  
  const price = parseInt(cleaned, 10);
  return isNaN(price) ? null : price;
}

// Scrapers for different sites
async function scrapeTokopedia(url: string): Promise<ScrapedProduct | ScrapeError> {
  try {
    const response = await axios.get(url, {
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9,id;q=0.8',
      },
    });
    
    const $ = cheerio.load(response.data);
    
    // Try to get data from JSON-LD
    const jsonLd = $('script[type="application/ld+json"]').first().text();
    let productData: any = {};
    
    if (jsonLd) {
      try {
        const parsed = JSON.parse(jsonLd);
        if (parsed['@type'] === 'Product') {
          productData = parsed;
        }
      } catch (e) {
        // JSON-LD parsing failed, fallback to meta tags
      }
    }
    
    // Extract from meta tags
    const name = productData.name || 
                 $('meta[property="og:title"]').attr('content') ||
                 $('h1[data-testid="lblPDPDetailProductName"]').text() ||
                 $('h1').first().text() ||
                 '';
    
    const priceText = productData.offers?.price?.toString() ||
                      $('meta[property="product:price:amount"]').attr('content') ||
                      $('meta[property="og:price:amount"]').attr('content') ||
                      $('[data-testid="lblPDPDetailProductPrice"]').text() ||
                      $('.price').first().text() ||
                      '';
    
    const price = parsePrice(priceText);
    
    const description = productData.description ||
                        $('meta[property="og:description"]').attr('content') ||
                        '';
    
    const imageUrl = productData.image ||
                     $('meta[property="og:image"]').attr('content') ||
                     $('meta[property="product:image"]').attr('content') ||
                     '';
    
    if (!name) {
      return {
        success: false,
        error: 'scraping_failed',
        message: 'Could not extract product name from Tokopedia',
      };
    }
    
    return {
      success: true,
      data: {
        name: name.trim(),
        price: price || 0,
        description: description.trim(),
        imageUrl: '', // Will be filled after downloading and uploading
        originalImageUrl: imageUrl,
        source: 'Tokopedia',
        currency: 'IDR',
        url,
      },
    };
  } catch (err) {
    console.error('Tokopedia scraping error:', err);
    return {
      success: false,
      error: 'scraping_failed',
      message: 'Failed to fetch product data from Tokopedia',
    };
  }
}

async function scrapeShopee(url: string): Promise<ScrapedProduct | ScrapeError> {
  try {
    // Shopee is harder to scrape due to dynamic rendering
    // Try to extract item ID and call their API
    const match = url.match(/\/(\d+)/);
    const itemId = match ? match[1] : null;
    const shopMatch = url.match(/shop\/(\d+)/);
    const shopId = shopMatch ? shopMatch[1] : null;
    
    // Fallback to meta tag scraping
    const response = await axios.get(url, {
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });
    
    const $ = cheerio.load(response.data);
    
    const name = $('meta[property="og:title"]').attr('content') ||
                 $('meta[name="twitter:title"]').attr('content') ||
                 $('h1').first().text() ||
                 '';
    
    const priceText = $('meta[property="product:price:amount"]').attr('content') ||
                      $('meta[property="og:price:amount"]').attr('content') ||
                      '';
    
    const price = parsePrice(priceText);
    
    const description = $('meta[property="og:description"]').attr('content') || '';
    
    const imageUrl = $('meta[property="og:image"]').attr('content') ||
                     $('meta[name="twitter:image"]').attr('content') ||
                     '';
    
    if (!name) {
      return {
        success: false,
        error: 'scraping_failed',
        message: 'Could not extract product data from Shopee',
      };
    }
    
    return {
      success: true,
      data: {
        name: name.trim(),
        price: price || 0,
        description: description.trim(),
        imageUrl: '',
        originalImageUrl: imageUrl,
        source: 'Shopee',
        currency: 'IDR',
        url,
      },
    };
  } catch (err) {
    console.error('Shopee scraping error:', err);
    return {
      success: false,
      error: 'scraping_failed',
      message: 'Failed to fetch product data from Shopee',
    };
  }
}

async function scrapeGeneric(url: string, domain: string): Promise<ScrapedProduct | ScrapeError> {
  try {
    const response = await axios.get(url, {
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });
    
    const $ = cheerio.load(response.data);
    
    // Try to extract from meta tags
    const name = $('meta[property="og:title"]').attr('content') ||
                 $('meta[name="twitter:title"]').attr('content') ||
                 $('title').text() ||
                 $('h1').first().text() ||
                 '';
    
    const priceText = $('meta[property="product:price:amount"]').attr('content') ||
                      $('meta[property="og:price:amount"]').attr('content') ||
                      $('[class*="price"]').first().text() ||
                      '';
    
    const price = parsePrice(priceText);
    
    const description = $('meta[property="og:description"]').attr('content') || '';
    
    const imageUrl = $('meta[property="og:image"]').attr('content') ||
                     $('meta[name="twitter:image"]').attr('content') ||
                     '';
    
    return {
      success: true,
      data: {
        name: name.trim() || 'Untitled Product',
        price: price || 0,
        description: description.trim(),
        imageUrl: '',
        originalImageUrl: imageUrl,
        source: domain.split('.')[0].charAt(0).toUpperCase() + domain.split('.')[0].slice(1),
        currency: 'IDR',
        url,
      },
    };
  } catch (err) {
    console.error('Generic scraping error:', err);
    return {
      success: false,
      error: 'scraping_failed',
      message: `Failed to fetch product data from ${domain}`,
    };
  }
}

// Main scrape function
export async function scrapeProduct(url: string): Promise<ScrapedProduct | ScrapeError> {
  // Validate URL
  if (!isValidUrl(url)) {
    return {
      success: false,
      error: 'invalid_url',
      message: 'Invalid URL format',
    };
  }
  
  // Check if domain is supported
  if (!isSupportedDomain(url)) {
    return {
      success: false,
      error: 'unsupported_domain',
      message: `This website is not supported. Supported sites: ${SUPPORTED_DOMAINS.join(', ')}`,
    };
  }
  
  // Check cache first
  const cacheKey = getCacheKey(url);
  const cached = await cacheGet<ScrapedProduct>(cacheKey);
  if (cached && cached.success) {
    console.log('Returning cached scrape result for:', url);
    return cached;
  }
  
  // Determine which scraper to use
  const domain = getDomain(url);
  let result: ScrapedProduct | ScrapeError;
  
  if (domain.includes('tokopedia')) {
    result = await scrapeTokopedia(url);
  } else if (domain.includes('shopee')) {
    result = await scrapeShopee(url);
  } else {
    result = await scrapeGeneric(url, domain);
  }
  
  // If scraping succeeded, download and upload image
  let imageError: string | undefined;
  if (result.success && result.data.originalImageUrl) {
    const imageBuffer = await downloadImage(result.data.originalImageUrl);
    if (imageBuffer) {
      const r2Key = await uploadImageToR2(imageBuffer, result.data.originalImageUrl);
      if (r2Key) {
        result.data.imageUrl = r2Key;
      } else {
        imageError = 'Failed to save product image to storage';
      }
    } else {
      imageError = 'Could not download product image (image may be protected or unavailable)';
    }
  }
  
  // Cache the result (even if image upload failed)
  if (result.success) {
    if (imageError) {
      (result as ScrapedProduct).imageError = imageError;
    }
    await cacheSet(cacheKey, result, CACHE_TTL);
  }
  
  return result;
}
