import axios from 'axios';
import * as cheerio from 'cheerio';
import crypto from 'crypto';
import { cacheGet, cacheSet } from '../cache/redis';
import { uploadFile } from '../services/r2';

// Supported e-commerce domains
const SUPPORTED_DOMAINS = [
  { domain: 'tokopedia.com', name: 'Tokopedia', priority: 1 },
  { domain: 'shopee.co.id', name: 'Shopee', priority: 1 },
  { domain: 'shopee.com', name: 'Shopee', priority: 1 },
  { domain: 'bukalapak.com', name: 'Bukalapak', priority: 2 },
  { domain: 'lazada.co.id', name: 'Lazada', priority: 2 },
  { domain: 'blibli.com', name: 'Blibli', priority: 2 },
];

// Cache TTL: 7 days
const CACHE_TTL = 7 * 24 * 60 * 60;

// Maximum content length to prevent memory issues
const MAX_CONTENT_LENGTH = 5 * 1024 * 1024; // 5MB

export interface ScrapedProductData {
  name: string;
  description: string;
  shortDescription?: string;
  price: number;
  originalPrice?: number;
  discountPercentage?: number;
  currency: string;
  imageUrl: string;
  galleryImages?: string[];
  rating?: number;
  reviewCount?: number;
  sellerName?: string;
  brand?: string;
  availability?: 'in_stock' | 'out_of_stock' | 'pre_order';
  source: string;
  url: string;
  productId?: string;
}

export interface ScrapingAttempt {
  method: string;
  success: boolean;
  timestamp: number;
  duration: number;
  error?: string;
  dataFound?: Partial<ScrapedProductData>;
}

export interface ScrapingResult {
  success: boolean;
  data?: ScrapedProductData;
  attempts: ScrapingAttempt[];
  requiresAdvancedScraping: boolean;
  error?: {
    code: string;
    message: string;
    suggestions: string[];
  };
}

// Helper functions
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

function getDomain(url: string): { domain: string; name: string; priority: number } | null {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.replace(/^www\./, '');
    const match = SUPPORTED_DOMAINS.find(s => hostname.includes(s.domain));
    return match || { domain: hostname, name: hostname.split('.')[0], priority: 3 };
  } catch {
    return null;
  }
}

function isSupportedDomain(url: string): boolean {
  const domain = getDomain(url);
  return domain !== null;
}

// Price parsing helpers
function parsePrice(priceText: string): number | null {
  if (!priceText) return null;
  
  // Remove currency symbols and normalize
  const cleaned = priceText
    .replace(/[^\d.,]/g, '')
    .replace(/\./g, '') // Remove thousand separators
    .replace(/,/g, '.'); // Convert decimal comma to dot
  
  const price = parseFloat(cleaned);
  return isNaN(price) ? null : Math.round(price);
}

function parseIndonesianPrice(priceText: string): { price: number | null; originalPrice?: number; discount?: number } {
  const result: { price: number | null; originalPrice?: number; discount?: number } = { price: null };
  
  if (!priceText) return result;
  
  // Try to find sale pattern: "Rp 1.000.000 Rp 750.000"
  const saleMatch = priceText.match(/Rp\s*([\d.,]+).*?Rp\s*([\d.,]+)/);
  if (saleMatch) {
    result.originalPrice = parsePrice(saleMatch[1]) || undefined;
    result.price = parsePrice(saleMatch[2]);
    if (result.originalPrice && result.price) {
      result.discount = Math.round((1 - result.price / result.originalPrice) * 100);
    }
    return result;
  }
  
  // Single price
  result.price = parsePrice(priceText);
  return result;
}

// Image download and upload
async function downloadImage(imageUrl: string): Promise<Buffer | null> {
  try {
    const response = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
      timeout: 10000,
      maxRedirects: 5,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
      },
    });
    
    const contentType = response.headers['content-type'];
    if (!contentType || !contentType.startsWith('image/')) {
      return null;
    }
    
    const size = response.data.length;
    if (size > 5 * 1024 * 1024) {
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

// Extractor methods
interface ExtractorResult {
  success: boolean;
  data?: Partial<ScrapedProductData>;
  error?: string;
}

type ExtractorMethod = (html: string, url: string) => ExtractorResult;

// Generic extractors
const genericExtractors: Record<string, ExtractorMethod> = {
  jsonLd: (html: string) => {
    try {
      const $ = cheerio.load(html);
      const scripts = $('script[type="application/ld+json"]');
      
      for (let i = 0; i < scripts.length; i++) {
        const script = $(scripts[i]);
        const jsonText = script.text();
        
        try {
          const data = JSON.parse(jsonText);
          
          // Check for Product schema
          if (data['@type'] === 'Product' || (Array.isArray(data['@graph']) && data['@graph'].some((item: any) => item['@type'] === 'Product'))) {
            const product = data['@type'] === 'Product' ? data : data['@graph'].find((item: any) => item['@type'] === 'Product');
            
            const result: Partial<ScrapedProductData> = {
              name: product.name,
              description: product.description || '',
            };
            
            // Extract price from offers
            if (product.offers) {
              const offers = Array.isArray(product.offers) ? product.offers[0] : product.offers;
              if (offers.price) {
                result.price = parsePrice(offers.price.toString()) || 0;
              }
              if (offers.availability) {
                result.availability = offers.availability.includes('InStock') ? 'in_stock' : 'out_of_stock';
              }
            }
            
            // Extract image
            if (product.image) {
              result.imageUrl = Array.isArray(product.image) ? product.image[0] : product.image;
            }
            
            // Extract brand
            if (product.brand?.name) {
              result.brand = product.brand.name;
            }
            
            // Extract rating
            if (product.aggregateRating) {
              result.rating = parseFloat(product.aggregateRating.ratingValue);
              result.reviewCount = parseInt(product.aggregateRating.reviewCount);
            }
            
            if (result.name) {
              return { success: true, data: result };
            }
          }
        } catch (e) {
          // Continue to next script
        }
      }
      
      return { success: false, error: 'No Product JSON-LD found' };
    } catch (e) {
      return { success: false, error: 'Failed to parse JSON-LD' };
    }
  },
  
  metaTags: (html: string, url: string) => {
    try {
      const $ = cheerio.load(html);
      const result: Partial<ScrapedProductData> = {};
      
      // Open Graph tags
      result.name = $('meta[property="og:title"]').attr('content') || 
                    $('meta[name="twitter:title"]').attr('content') || '';
      
      result.description = $('meta[property="og:description"]').attr('content') || 
                           $('meta[name="twitter:description"]').attr('content') || '';
      
      result.imageUrl = $('meta[property="og:image"]').attr('content') || 
                        $('meta[name="twitter:image"]').attr('content') || '';
      
      // Price from meta
      const priceMeta = $('meta[property="product:price:amount"]').attr('content') ||
                        $('meta[property="og:price:amount"]').attr('content');
      if (priceMeta) {
        result.price = parsePrice(priceMeta) || 0;
      }
      
      if (result.name) {
        return { success: true, data: result };
      }
      
      return { success: false, error: 'Missing required meta tags' };
    } catch (e) {
      return { success: false, error: 'Failed to extract meta tags' };
    }
  },
  
  schemaOrg: (html: string) => {
    try {
      const $ = cheerio.load(html);
      const result: Partial<ScrapedProductData> = {};
      
      // Look for itemtype="http://schema.org/Product"
      const productElement = $('[itemtype*="schema.org/Product"]').first();
      
      if (productElement.length) {
        result.name = productElement.find('[itemprop="name"]').first().text().trim();
        result.description = productElement.find('[itemprop="description"]').first().text().trim();
        
        const priceElement = productElement.find('[itemprop="price"]').first();
        if (priceElement.length) {
          result.price = parsePrice(priceElement.attr('content') || priceElement.text()) || 0;
        }
        
        const imageElement = productElement.find('[itemprop="image"]').first();
        if (imageElement.length) {
          result.imageUrl = imageElement.attr('src') || imageElement.attr('content') || '';
        }
        
        if (result.name) {
          return { success: true, data: result };
        }
      }
      
      return { success: false, error: 'No schema.org Product found' };
    } catch (e) {
      return { success: false, error: 'Failed to parse schema.org' };
    }
  },
};

// Site-specific extractors
const siteExtractors: Record<string, ExtractorMethod[]> = {
  'tokopedia.com': [
    // Method 1: Tokopedia specific data attributes
    (html: string) => {
      try {
        const $ = cheerio.load(html);
        const result: Partial<ScrapedProductData> = {};
        
        // Try specific Tokopedia selectors
        result.name = $('[data-testid="lblPDPDetailProductName"]').first().text().trim() ||
                      $('h1[data-testid="pdpProductName"]').first().text().trim() ||
                      $('h1.css-1os9qcq').first().text().trim() || '';
        
        const priceText = $('[data-testid="lblPDPDetailProductPrice"]').first().text().trim() ||
                          $('.price').first().text().trim() || '';
        
        if (priceText) {
          const priceInfo = parseIndonesianPrice(priceText);
          result.price = priceInfo.price || 0;
          result.originalPrice = priceInfo.originalPrice;
          result.discountPercentage = priceInfo.discount;
        }
        
        // Description
        result.description = $('[data-testid="lblPDPDescriptionProduk"]').first().text().trim() ||
                            $('.css-1wee9a1').first().text().trim() || '';
        
        // Image from data attribute
        const imgElement = $('[data-testid="PDPMainImage"] img').first() ||
                          $('.css-1c345mg img').first();
        result.imageUrl = imgElement.attr('src') || 
                          imgElement.attr('data-src') || '';
        
        // Rating
        const ratingText = $('[data-testid="lblPDPDetailProductRatingNumber"]').first().text().trim();
        if (ratingText) {
          result.rating = parseFloat(ratingText);
        }
        
        // Seller
        result.sellerName = $('[data-testid="llbPDPFooterShopName"]').first().text().trim() || '';
        
        if (result.name) {
          return { success: true, data: result };
        }
        
        return { success: false, error: 'Tokopedia specific selectors failed' };
      } catch (e) {
        return { success: false, error: 'Tokopedia selector error' };
      }
    },
    // Method 2: Generic JSON-LD (fallback)
    genericExtractors.jsonLd,
    // Method 3: Meta tags (fallback)
    genericExtractors.metaTags,
  ],
  
  'shopee.co.id': [
    // Method 1: Try meta tags (most reliable for Shopee)
    (html: string, url: string) => {
      try {
        const $ = cheerio.load(html);
        const result: Partial<ScrapedProductData> = {};
        
        // Shopee usually has good meta tags
        result.name = $('meta[property="og:title"]').attr('content') ||
                      $('meta[name="twitter:title"]').attr('content') ||
                      $('title').text().replace(' | Shopee Indonesia', '').trim() || '';
        
        result.description = $('meta[property="og:description"]').attr('content') || 
                             $('meta[name="description"]').attr('content') || '';
        
        result.imageUrl = $('meta[property="og:image"]').attr('content') ||
                          $('meta[name="twitter:image"]').attr('content') || '';
        
        // Try to find price in meta or JSON-LD
        const priceMeta = $('meta[property="product:price:amount"]').attr('content');
        if (priceMeta) {
          result.price = parsePrice(priceMeta) || 0;
        }
        
        // If we got a name, return success but note that advanced scraping might get more data
        if (result.name && result.name.length > 5) {
          return { success: true, data: result };
        }
        
        return { success: false, error: 'Shopee meta tags insufficient - page requires JavaScript rendering' };
      } catch (e) {
        return { success: false, error: 'Shopee meta extraction failed' };
      }
    },
    // Method 2: JSON-LD
    genericExtractors.jsonLd,
    // Method 3: Generic meta tags
    genericExtractors.metaTags,
  ],
  
  'shopee.com': [
    // Same as shopee.co.id
    (html: string, url: string) => {
      const extractors = siteExtractors['shopee.co.id'];
      for (const extractor of extractors) {
        const result = extractor(html, url);
        if (result.success) return result;
      }
      return { success: false, error: 'All Shopee extractors failed' };
    },
  ],
};

// Main scraping function
export async function scrapeProduct(url: string, useAdvanced = false): Promise<ScrapingResult> {
  const startTime = Date.now();
  const attempts: ScrapingAttempt[] = [];
  
  // Validate URL
  if (!isValidUrl(url)) {
    return {
      success: false,
      attempts,
      requiresAdvancedScraping: false,
      error: {
        code: 'invalid_url',
        message: 'Invalid URL format. Please enter a valid http:// or https:// URL.',
        suggestions: ['Check that the URL starts with http:// or https://', 'Copy the URL directly from your browser address bar'],
      },
    };
  }
  
  // Check domain support
  const domainInfo = getDomain(url);
  if (!domainInfo) {
    return {
      success: false,
      attempts,
      requiresAdvancedScraping: false,
      error: {
        code: 'unsupported_domain',
        message: `This website is not supported.`,
        suggestions: [
          'Supported sites: Tokopedia, Shopee, Bukalapak, Lazada, Blibli',
          'Try entering the product details manually',
        ],
      },
    };
  }
  
  // Check cache
  const cacheKey = getCacheKey(url);
  const cached = await cacheGet<ScrapingResult>(cacheKey);
  if (cached && cached.success) {
    return cached;
  }
  
  // Fetch HTML
  let html: string;
  try {
    const response = await axios.get(url, {
      timeout: useAdvanced ? 30000 : 10000,
      maxRedirects: 5,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.537 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9,id;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
      },
      maxContentLength: MAX_CONTENT_LENGTH,
    });
    
    html = response.data;
    
    if (!html || html.length < 100) {
      throw new Error('Empty or invalid response');
    }
  } catch (err: any) {
    const isTimeout = err.code === 'ECONNABORTED' || err.message?.includes('timeout');
    
    return {
      success: false,
      attempts,
      requiresAdvancedScraping: isTimeout,
      error: {
        code: isTimeout ? 'timeout' : 'fetch_failed',
        message: isTimeout 
          ? 'The request timed out. The site may be slow or blocking automated requests.'
          : `Failed to fetch page: ${err.message || 'Unknown error'}`,
        suggestions: isTimeout 
          ? ['Try the Advanced Scraping option', 'Check if the site is accessible in your browser', 'Try again later']
          : ['Check that the URL is correct and accessible', 'The site may be blocking automated requests', 'Try the Advanced Scraping option'],
      },
    };
  }
  
  // Get extractors for this domain
  const extractors = siteExtractors[domainInfo.domain] || [
    genericExtractors.jsonLd,
    genericExtractors.metaTags,
    genericExtractors.schemaOrg,
  ];
  
  // Try each extractor
  let bestResult: Partial<ScrapedProductData> = {};
  
  for (const extractor of extractors) {
    const methodStart = Date.now();
    const extractorName = extractor.name || 'unknown';
    
    try {
      const result = extractor(html, url);
      
      attempts.push({
        method: extractorName,
        success: result.success,
        timestamp: Date.now(),
        duration: Date.now() - methodStart,
        error: result.error,
        dataFound: result.data,
      });
      
      if (result.success && result.data) {
        // Merge with best result (prioritize non-empty values)
        bestResult = { ...bestResult, ...result.data };
        
        // If we have all essential data, we can stop
        if (bestResult.name && bestResult.price && bestResult.imageUrl) {
          break;
        }
      }
    } catch (e: any) {
      attempts.push({
        method: extractorName,
        success: false,
        timestamp: Date.now(),
        duration: Date.now() - methodStart,
        error: e.message || 'Extractor threw error',
      });
    }
  }
  
  // Check if we have enough data
  const hasName = !!bestResult.name;
  const hasPrice = bestResult.price !== undefined && bestResult.price > 0;
  const hasImage = !!bestResult.imageUrl;
  
  // If we have name but missing other critical fields, suggest advanced scraping
  const requiresAdvanced = hasName && (!hasPrice || !hasImage);
  
  if (!hasName) {
    return {
      success: false,
      attempts,
      requiresAdvancedScraping: true,
      error: {
        code: 'scraping_failed',
        message: 'Could not extract product information from this page.',
        suggestions: [
          'The site may use JavaScript to load content',
          'Try the Advanced Scraping option with Puppeteer',
          'Enter the product details manually',
          'Check if the URL is a valid product page',
        ],
      },
    };
  }
  
  // Fill in missing fields with defaults
  const finalData: ScrapedProductData = {
    name: bestResult.name || 'Unknown Product',
    description: bestResult.description || bestResult.shortDescription || '',
    price: bestResult.price || 0,
    originalPrice: bestResult.originalPrice,
    discountPercentage: bestResult.discountPercentage,
    currency: bestResult.currency || 'IDR',
    imageUrl: bestResult.imageUrl || '',
    galleryImages: bestResult.galleryImages,
    rating: bestResult.rating,
    reviewCount: bestResult.reviewCount,
    sellerName: bestResult.sellerName,
    brand: bestResult.brand,
    availability: bestResult.availability,
    source: domainInfo.name,
    url,
    productId: bestResult.productId,
  };
  
  // Download and upload image
  let imageError: string | undefined;
  if (finalData.imageUrl) {
    const imageBuffer = await downloadImage(finalData.imageUrl);
    if (imageBuffer) {
      const r2Key = await uploadImageToR2(imageBuffer, finalData.imageUrl);
      if (r2Key) {
        finalData.imageUrl = r2Key;
      } else {
        imageError = 'Failed to save product image to storage';
      }
    } else {
      imageError = 'Could not download product image (may be protected or unavailable)';
      finalData.imageUrl = '';
    }
  }
  
  // Build result
  const result: ScrapingResult = {
    success: true,
    data: finalData,
    attempts,
    requiresAdvancedScraping: requiresAdvanced,
  };
  
  if (imageError) {
    // We'll still cache this but note the image error
    console.warn(`Image error for ${url}: ${imageError}`);
  }
  
  // Cache successful results
  await cacheSet(cacheKey, result, CACHE_TTL);
  
  return result;
}

// Advanced scraping with Puppeteer
export async function scrapeProductAdvanced(url: string): Promise<ScrapingResult> {
  const startTime = Date.now();
  const attempts: ScrapingAttempt[] = [];
  
  // Validate URL
  if (!isValidUrl(url)) {
    return {
      success: false,
      attempts,
      requiresAdvancedScraping: false,
      error: {
        code: 'invalid_url',
        message: 'Invalid URL format.',
        suggestions: ['Check that the URL is valid'],
      },
    };
  }
  
  const domainInfo = getDomain(url);
  if (!domainInfo) {
    return {
      success: false,
      attempts,
      requiresAdvancedScraping: false,
      error: {
        code: 'unsupported_domain',
        message: 'Domain not supported.',
        suggestions: ['Try a supported e-commerce site'],
      },
    };
  }
  
  // Dynamic import puppeteer to avoid loading it unless needed
  let puppeteer;
  try {
    puppeteer = await import('puppeteer');
  } catch (e) {
    return {
      success: false,
      attempts,
      requiresAdvancedScraping: false,
      error: {
        code: 'puppeteer_not_available',
        message: 'Advanced scraping is not available. Puppeteer is not installed.',
        suggestions: ['Contact administrator to enable advanced scraping'],
      },
    };
  }
  
  const methodStart = Date.now();
  let browser;
  
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--window-size=1920,1080',
      ],
    });
    
    const page = await browser.newPage();
    
    // Set user agent
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    // Navigate and wait for content
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    
    // Wait a bit for any final rendering
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Get rendered HTML
    const html = await page.content();
    
    attempts.push({
      method: 'puppeteer',
      success: true,
      timestamp: Date.now(),
      duration: Date.now() - methodStart,
    });
    
    // Close browser
    await browser.close();
    
    // Now scrape the rendered HTML with regular methods
    const extractors = siteExtractors[domainInfo.domain] || [
      genericExtractors.jsonLd,
      genericExtractors.metaTags,
      genericExtractors.schemaOrg,
    ];
    
    let bestResult: Partial<ScrapedProductData> = {};
    
    for (const extractor of extractors) {
      const extractorStart = Date.now();
      const extractorName = extractor.name || 'unknown';
      
      try {
        const result = extractor(html, url);
        
        attempts.push({
          method: `puppeteer+${extractorName}`,
          success: result.success,
          timestamp: Date.now(),
          duration: Date.now() - extractorStart,
          error: result.error,
          dataFound: result.data,
        });
        
        if (result.success && result.data) {
          bestResult = { ...bestResult, ...result.data };
          
          if (bestResult.name && bestResult.price && bestResult.imageUrl) {
            break;
          }
        }
      } catch (e: any) {
        attempts.push({
          method: `puppeteer+${extractorName}`,
          success: false,
          timestamp: Date.now(),
          duration: Date.now() - extractorStart,
          error: e.message,
        });
      }
    }
    
    // Check results
    if (!bestResult.name) {
      return {
        success: false,
        attempts,
        requiresAdvancedScraping: false,
        error: {
          code: 'advanced_scraping_failed',
          message: 'Advanced scraping could not extract product information.',
          suggestions: [
            'The site may have anti-scraping protection',
            'Try entering product details manually',
            'Check if the URL is correct',
          ],
        },
      };
    }
    
    // Build final data
    const finalData: ScrapedProductData = {
      name: bestResult.name || 'Unknown Product',
      description: bestResult.description || '',
      price: bestResult.price || 0,
      originalPrice: bestResult.originalPrice,
      discountPercentage: bestResult.discountPercentage,
      currency: bestResult.currency || 'IDR',
      imageUrl: bestResult.imageUrl || '',
      source: domainInfo.name,
      url,
    };
    
    // Download and upload image
    if (finalData.imageUrl) {
      const imageBuffer = await downloadImage(finalData.imageUrl);
      if (imageBuffer) {
        const r2Key = await uploadImageToR2(imageBuffer, finalData.imageUrl);
        if (r2Key) {
          finalData.imageUrl = r2Key;
        }
      }
    }
    
    const result: ScrapingResult = {
      success: true,
      data: finalData,
      attempts,
      requiresAdvancedScraping: false,
    };
    
    // Cache result
    const cacheKey = getCacheKey(url);
    await cacheSet(cacheKey, result, CACHE_TTL);
    
    return result;
    
  } catch (err: any) {
    if (browser) {
      await browser.close();
    }
    
    attempts.push({
      method: 'puppeteer',
      success: false,
      timestamp: Date.now(),
      duration: Date.now() - methodStart,
      error: err.message || 'Puppeteer error',
    });
    
    return {
      success: false,
      attempts,
      requiresAdvancedScraping: false,
      error: {
        code: 'puppeteer_error',
        message: `Advanced scraping failed: ${err.message || 'Unknown error'}`,
        suggestions: [
          'The site may be blocking browser automation',
          'Try entering product details manually',
        ],
      },
    };
  }
}
