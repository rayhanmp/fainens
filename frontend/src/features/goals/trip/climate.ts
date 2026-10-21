/**
 * Places people often travel to, for picking where a trip goes, each with its usual daily highs
 * and lows (°C, January to December, rounded long-term monthly averages) so a trip's weather can
 * be guessed from where it goes and when. They say what a month is usually like, not a forecast.
 */

export type Climate = 'cold' | 'warm' | 'mixed';
export const WEATHER: Record<Climate, string> = { cold: 'Cold', warm: 'Warm', mixed: 'Some of each' };
export type KnownPlace = { name: string; country: string; high: number[]; low: number[] };

export const CLIMATE_SOURCE = 'Usual temperatures are rounded long-term monthly averages, not a forecast.';

const P = (name: string, country: string, high: number[], low: number[]): KnownPlace => ({ name, country, high, low });

/** Roughly by how often people go, so the list opens with the likeliest. */
export const KNOWN_PLACES: KnownPlace[] = [
  // Japan
  P('Tokyo', 'Japan', [10, 11, 14, 19, 23, 26, 30, 31, 27, 22, 17, 12], [1, 2, 5, 10, 15, 19, 23, 24, 21, 15, 9, 4]),
  P('Osaka', 'Japan', [10, 10, 14, 20, 25, 28, 32, 33, 29, 23, 17, 12], [3, 3, 6, 11, 16, 20, 25, 26, 22, 16, 10, 5]),
  P('Kyoto', 'Japan', [9, 10, 14, 20, 25, 28, 32, 34, 29, 23, 17, 12], [1, 2, 4, 9, 15, 19, 24, 25, 21, 14, 8, 3]),
  P('Sapporo', 'Japan', [-1, 0, 4, 11, 17, 21, 25, 26, 22, 16, 8, 2], [-7, -7, -3, 3, 9, 13, 18, 19, 15, 8, 2, -4]),
  P('Fukuoka', 'Japan', [10, 12, 15, 20, 24, 27, 31, 33, 29, 24, 18, 13], [4, 4, 7, 11, 16, 20, 24, 25, 21, 15, 10, 5]),
  P('Nagoya', 'Japan', [10, 11, 15, 20, 25, 28, 32, 33, 29, 23, 17, 12], [1, 1, 4, 10, 15, 19, 24, 25, 21, 15, 8, 3]),
  P('Hiroshima', 'Japan', [10, 11, 14, 20, 24, 27, 31, 33, 29, 23, 17, 12], [2, 2, 5, 10, 15, 19, 24, 25, 21, 14, 8, 4]),
  P('Kanazawa', 'Japan', [7, 8, 12, 18, 23, 26, 30, 32, 27, 22, 16, 10], [1, 1, 3, 8, 13, 18, 23, 24, 20, 13, 8, 3]),
  P('Okinawa', 'Japan', [20, 20, 22, 25, 28, 31, 32, 32, 31, 28, 25, 21], [15, 15, 17, 20, 23, 26, 27, 27, 26, 23, 20, 16]),
  // Korea, China, Taiwan
  P('Seoul', 'South Korea', [2, 5, 11, 18, 24, 28, 29, 30, 26, 20, 12, 4], [-6, -4, 1, 7, 13, 18, 22, 23, 18, 11, 4, -3]),
  P('Busan', 'South Korea', [8, 10, 14, 19, 23, 25, 28, 30, 27, 23, 17, 11], [0, 2, 6, 11, 15, 19, 23, 24, 21, 15, 8, 2]),
  P('Jeju', 'South Korea', [9, 10, 13, 18, 22, 25, 29, 31, 27, 22, 17, 12], [4, 4, 7, 11, 15, 19, 24, 25, 21, 16, 10, 5]),
  P('Beijing', 'China', [2, 6, 13, 21, 27, 31, 31, 30, 26, 19, 10, 3], [-8, -5, 1, 8, 14, 19, 22, 21, 16, 8, 0, -6]),
  P('Shanghai', 'China', [8, 10, 14, 20, 25, 28, 32, 32, 28, 23, 17, 11], [1, 3, 6, 11, 16, 21, 25, 25, 21, 16, 10, 3]),
  P('Guangzhou', 'China', [19, 20, 23, 27, 30, 32, 33, 33, 32, 29, 25, 21], [11, 13, 16, 20, 23, 25, 26, 26, 24, 21, 16, 12]),
  P('Chengdu', 'China', [10, 13, 18, 23, 27, 29, 31, 31, 26, 21, 16, 11], [3, 6, 9, 14, 18, 21, 23, 22, 19, 15, 10, 5]),
  P('Xi’an', 'China', [6, 10, 16, 22, 27, 32, 33, 31, 26, 20, 13, 7], [-3, 0, 5, 11, 16, 21, 23, 22, 17, 11, 4, -2]),
  P('Harbin', 'China', [-12, -7, 2, 13, 21, 26, 28, 26, 21, 12, 0, -10], [-24, -20, -10, 0, 8, 15, 19, 17, 9, 0, -11, -21]),
  P('Hong Kong', 'China', [19, 20, 22, 26, 29, 31, 32, 32, 31, 28, 25, 21], [15, 15, 18, 21, 24, 27, 27, 27, 26, 24, 20, 16]),
  P('Macau', 'China', [18, 19, 21, 25, 28, 31, 32, 32, 31, 28, 24, 20], [14, 15, 17, 21, 24, 26, 27, 26, 25, 22, 18, 15]),
  P('Taipei', 'Taiwan', [19, 20, 22, 26, 29, 32, 34, 34, 31, 27, 24, 21], [14, 14, 16, 19, 22, 25, 26, 26, 25, 22, 19, 16]),
  // Southeast Asia
  P('Singapore', 'Singapore', [30, 31, 32, 32, 32, 31, 31, 31, 31, 31, 31, 30], [24, 24, 24, 25, 25, 25, 25, 25, 25, 24, 24, 24]),
  P('Kuala Lumpur', 'Malaysia', [32, 33, 33, 33, 33, 33, 32, 32, 32, 32, 32, 32], [23, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 23]),
  P('Penang', 'Malaysia', [32, 32, 32, 32, 32, 32, 31, 31, 31, 31, 31, 31], [24, 24, 25, 25, 25, 25, 24, 24, 24, 24, 24, 24]),
  P('Langkawi', 'Malaysia', [32, 33, 34, 33, 32, 31, 31, 31, 31, 31, 31, 31], [23, 23, 24, 25, 25, 25, 24, 24, 24, 24, 24, 23]),
  P('Malacca', 'Malaysia', [31, 32, 33, 33, 32, 32, 31, 31, 31, 31, 31, 31], [23, 23, 24, 24, 24, 24, 23, 23, 23, 24, 24, 23]),
  P('Kota Kinabalu', 'Malaysia', [31, 31, 32, 33, 33, 32, 32, 32, 32, 32, 31, 31], [23, 23, 24, 24, 25, 24, 24, 24, 24, 24, 24, 24]),
  P('Genting Highlands', 'Malaysia', [23, 23, 24, 24, 24, 24, 23, 23, 23, 23, 23, 22], [15, 15, 16, 16, 16, 16, 15, 15, 15, 15, 15, 15]),
  P('Bangkok', 'Thailand', [33, 33, 34, 35, 34, 33, 33, 33, 32, 32, 32, 32], [22, 24, 26, 27, 27, 26, 26, 26, 25, 25, 24, 22]),
  P('Phuket', 'Thailand', [32, 33, 34, 34, 32, 32, 31, 31, 31, 31, 31, 31], [23, 24, 25, 25, 25, 25, 25, 25, 24, 24, 24, 23]),
  P('Chiang Mai', 'Thailand', [30, 33, 35, 36, 34, 32, 31, 31, 31, 31, 30, 29], [15, 16, 19, 23, 24, 24, 24, 24, 23, 22, 19, 16]),
  P('Krabi', 'Thailand', [32, 33, 34, 34, 33, 32, 32, 31, 31, 31, 31, 31], [22, 22, 23, 24, 24, 24, 24, 24, 24, 23, 23, 22]),
  P('Pattaya', 'Thailand', [32, 32, 33, 34, 34, 33, 33, 33, 32, 32, 32, 31], [22, 24, 25, 26, 26, 26, 25, 25, 25, 24, 23, 22]),
  P('Ko Samui', 'Thailand', [30, 31, 32, 33, 33, 32, 32, 32, 32, 31, 30, 29], [24, 24, 25, 26, 26, 26, 25, 25, 25, 25, 24, 24]),
  P('Hanoi', 'Vietnam', [20, 21, 23, 28, 32, 33, 33, 32, 31, 29, 26, 22], [14, 16, 18, 22, 25, 26, 27, 26, 25, 22, 19, 15]),
  P('Ho Chi Minh City', 'Vietnam', [32, 33, 34, 35, 34, 33, 32, 32, 32, 31, 31, 31], [22, 23, 24, 26, 26, 25, 25, 25, 25, 24, 24, 23]),
  P('Da Nang', 'Vietnam', [25, 26, 29, 31, 33, 34, 34, 34, 32, 29, 27, 25], [19, 20, 22, 24, 25, 26, 26, 26, 24, 23, 22, 20]),
  P('Nha Trang', 'Vietnam', [28, 29, 30, 32, 33, 33, 33, 33, 32, 30, 29, 28], [21, 22, 23, 25, 26, 26, 26, 26, 25, 24, 23, 22]),
  P('Siem Reap', 'Cambodia', [32, 34, 35, 36, 35, 34, 33, 32, 32, 31, 31, 31], [20, 22, 24, 26, 26, 26, 25, 25, 25, 24, 22, 20]),
  P('Phnom Penh', 'Cambodia', [32, 33, 35, 35, 35, 34, 33, 33, 32, 31, 31, 31], [22, 23, 24, 26, 26, 26, 25, 25, 25, 25, 24, 22]),
  P('Luang Prabang', 'Laos', [28, 31, 33, 35, 34, 33, 32, 32, 32, 31, 29, 27], [14, 15, 18, 21, 23, 24, 24, 24, 23, 21, 18, 15]),
  P('Manila', 'Philippines', [30, 31, 32, 34, 34, 33, 31, 31, 31, 31, 31, 30], [24, 24, 25, 26, 27, 26, 26, 25, 25, 25, 25, 24]),
  P('Cebu', 'Philippines', [30, 30, 31, 32, 33, 32, 32, 32, 32, 31, 31, 30], [24, 24, 24, 25, 26, 26, 25, 25, 25, 25, 25, 24]),
  // Indonesia
  P('Bali', 'Indonesia', [31, 31, 31, 32, 31, 30, 30, 30, 31, 32, 32, 31], [24, 24, 24, 24, 24, 23, 23, 23, 23, 24, 24, 24]),
  P('Jakarta', 'Indonesia', [31, 31, 32, 33, 33, 33, 33, 33, 34, 34, 33, 32], [25, 25, 25, 25, 25, 24, 24, 24, 25, 25, 25, 25]),
  P('Bandung', 'Indonesia', [28, 28, 28, 28, 28, 28, 28, 29, 29, 29, 28, 28], [18, 18, 18, 18, 18, 17, 17, 17, 17, 18, 18, 18]),
  P('Yogyakarta', 'Indonesia', [30, 30, 31, 31, 31, 31, 31, 32, 32, 32, 31, 30], [23, 23, 23, 23, 23, 22, 21, 21, 22, 23, 23, 23]),
  P('Surabaya', 'Indonesia', [31, 31, 31, 32, 32, 31, 31, 32, 33, 34, 33, 32], [24, 24, 24, 24, 24, 23, 22, 22, 23, 24, 25, 24]),
  P('Malang', 'Indonesia', [28, 28, 28, 29, 29, 28, 28, 29, 30, 30, 29, 28], [20, 20, 20, 20, 19, 18, 17, 17, 18, 19, 20, 20]),
  P('Lombok', 'Indonesia', [31, 31, 31, 31, 31, 30, 30, 30, 31, 32, 32, 31], [24, 24, 24, 24, 23, 22, 21, 21, 22, 23, 24, 24]),
  P('Labuan Bajo', 'Indonesia', [31, 31, 31, 32, 32, 31, 31, 31, 32, 33, 33, 32], [24, 24, 24, 24, 23, 22, 21, 21, 22, 23, 24, 24]),
  P('Medan', 'Indonesia', [30, 31, 32, 32, 32, 32, 32, 32, 31, 31, 30, 30], [23, 23, 23, 24, 24, 24, 23, 23, 23, 23, 23, 23]),
  P('Makassar', 'Indonesia', [30, 30, 31, 31, 31, 30, 30, 31, 32, 32, 31, 30], [23, 23, 23, 23, 23, 22, 21, 21, 22, 23, 23, 23]),
  P('Raja Ampat', 'Indonesia', [31, 31, 31, 31, 31, 30, 30, 30, 30, 31, 31, 31], [24, 24, 24, 24, 24, 24, 23, 23, 23, 24, 24, 24]),
  // South Asia and the Indian Ocean
  P('Maldives', 'Maldives', [30, 31, 31, 32, 31, 31, 31, 30, 30, 30, 30, 30], [26, 26, 27, 28, 27, 27, 26, 26, 26, 26, 26, 26]),
  P('Colombo', 'Sri Lanka', [31, 31, 32, 32, 31, 30, 30, 30, 30, 30, 30, 30], [23, 23, 24, 25, 26, 26, 25, 25, 25, 24, 24, 23]),
  P('Kathmandu', 'Nepal', [19, 21, 25, 28, 29, 29, 28, 29, 28, 27, 23, 20], [2, 4, 8, 11, 16, 19, 20, 20, 18, 13, 7, 3]),
  P('Delhi', 'India', [20, 24, 30, 36, 40, 39, 35, 34, 34, 33, 28, 22], [8, 11, 16, 22, 26, 28, 27, 27, 25, 19, 13, 8]),
  P('Mumbai', 'India', [31, 32, 33, 33, 34, 32, 30, 30, 31, 34, 34, 33], [17, 18, 21, 24, 27, 27, 26, 25, 25, 24, 21, 18]),
  // Middle East and Africa
  P('Makkah', 'Saudi Arabia', [31, 32, 35, 39, 42, 44, 44, 43, 43, 40, 35, 32], [19, 19, 21, 25, 28, 29, 30, 30, 29, 26, 23, 20]),
  P('Madinah', 'Saudi Arabia', [24, 26, 30, 35, 40, 43, 43, 44, 42, 37, 30, 25], [12, 14, 17, 22, 27, 29, 30, 30, 29, 24, 18, 14]),
  P('Jeddah', 'Saudi Arabia', [29, 30, 31, 34, 36, 37, 38, 38, 36, 35, 32, 30], [19, 19, 21, 23, 26, 27, 28, 29, 27, 25, 23, 21]),
  P('Dubai', 'United Arab Emirates', [24, 25, 29, 33, 38, 40, 41, 41, 39, 35, 30, 26], [15, 16, 18, 22, 26, 28, 30, 31, 28, 24, 20, 17]),
  P('Abu Dhabi', 'United Arab Emirates', [24, 26, 29, 34, 39, 41, 42, 42, 40, 36, 30, 26], [13, 14, 17, 20, 24, 27, 30, 30, 27, 23, 18, 15]),
  P('Doha', 'Qatar', [22, 24, 28, 33, 39, 42, 42, 41, 39, 35, 29, 24], [14, 15, 18, 22, 27, 29, 31, 31, 29, 25, 20, 16]),
  P('Muscat', 'Oman', [25, 26, 30, 35, 40, 41, 39, 36, 36, 35, 30, 27], [18, 19, 22, 26, 30, 31, 31, 29, 28, 26, 22, 20]),
  P('Amman', 'Jordan', [13, 14, 18, 23, 28, 31, 32, 32, 31, 27, 20, 15], [4, 5, 7, 11, 15, 18, 20, 20, 18, 15, 9, 6]),
  P('Jerusalem', 'Palestine and Israel', [12, 13, 16, 21, 25, 27, 29, 29, 28, 25, 19, 14], [6, 6, 9, 12, 16, 18, 20, 20, 19, 17, 12, 8]),
  P('Istanbul', 'Türkiye', [9, 9, 12, 16, 21, 26, 28, 29, 25, 20, 15, 11], [3, 3, 5, 8, 13, 18, 21, 21, 18, 14, 9, 5]),
  P('Cappadocia', 'Türkiye', [4, 6, 11, 16, 21, 26, 29, 29, 25, 19, 12, 6], [-5, -4, 0, 4, 8, 12, 15, 15, 11, 6, 1, -3]),
  P('Antalya', 'Türkiye', [15, 16, 18, 22, 26, 31, 34, 34, 31, 26, 21, 17], [6, 7, 9, 12, 16, 20, 23, 23, 19, 15, 11, 8]),
  P('Cairo', 'Egypt', [19, 21, 24, 28, 32, 34, 35, 35, 33, 30, 25, 21], [9, 10, 12, 15, 18, 21, 23, 23, 21, 18, 14, 11]),
  P('Marrakech', 'Morocco', [18, 20, 23, 25, 29, 33, 37, 37, 32, 28, 22, 19], [6, 8, 10, 12, 15, 18, 21, 21, 19, 15, 10, 7]),
  P('Cape Town', 'South Africa', [27, 27, 26, 23, 21, 19, 18, 18, 20, 22, 24, 26], [16, 16, 15, 12, 10, 8, 7, 8, 9, 11, 13, 15]),
  // Europe
  P('London', 'United Kingdom', [8, 9, 12, 15, 18, 21, 24, 23, 20, 16, 11, 9], [3, 3, 4, 6, 9, 12, 14, 14, 12, 9, 5, 3]),
  P('Edinburgh', 'United Kingdom', [7, 8, 10, 12, 15, 18, 19, 19, 17, 13, 10, 7], [1, 2, 3, 4, 7, 9, 11, 11, 9, 6, 3, 1]),
  P('Manchester', 'United Kingdom', [7, 8, 11, 13, 17, 19, 21, 21, 18, 14, 10, 8], [2, 2, 3, 5, 8, 11, 13, 13, 10, 8, 5, 2]),
  P('Dublin', 'Ireland', [8, 9, 11, 13, 15, 18, 20, 19, 17, 14, 10, 8], [3, 3, 4, 5, 8, 10, 12, 12, 10, 8, 5, 3]),
  P('Paris', 'France', [8, 9, 13, 16, 20, 23, 26, 26, 22, 17, 11, 8], [3, 3, 5, 7, 11, 14, 16, 16, 13, 10, 6, 4]),
  P('Nice', 'France', [13, 14, 16, 18, 22, 25, 28, 28, 25, 21, 17, 14], [5, 6, 8, 10, 14, 17, 20, 20, 17, 14, 9, 6]),
  P('Lyon', 'France', [7, 9, 14, 17, 21, 26, 29, 28, 24, 18, 11, 8], [1, 1, 4, 7, 11, 15, 17, 17, 13, 10, 5, 2]),
  P('Amsterdam', 'Netherlands', [6, 7, 10, 14, 18, 20, 23, 22, 19, 15, 10, 7], [1, 1, 3, 5, 9, 11, 14, 13, 11, 8, 4, 2]),
  P('Brussels', 'Belgium', [6, 8, 11, 15, 19, 22, 24, 23, 20, 15, 10, 7], [1, 1, 3, 6, 9, 12, 14, 14, 11, 8, 4, 2]),
  P('Zurich', 'Switzerland', [4, 6, 11, 15, 19, 23, 25, 24, 20, 15, 9, 5], [-2, -2, 1, 4, 8, 12, 14, 13, 10, 6, 2, -1]),
  P('Geneva', 'Switzerland', [5, 7, 12, 16, 20, 24, 27, 26, 21, 15, 9, 5], [-1, -1, 2, 5, 9, 13, 15, 14, 11, 7, 2, 0]),
  P('Lucerne', 'Switzerland', [4, 6, 11, 15, 19, 23, 25, 24, 20, 15, 8, 4], [-2, -2, 1, 5, 9, 12, 14, 14, 11, 7, 2, -1]),
  P('Interlaken', 'Switzerland', [3, 5, 10, 14, 18, 22, 24, 23, 19, 14, 8, 3], [-4, -4, -1, 3, 7, 10, 12, 12, 9, 5, 0, -3]),
  P('Rome', 'Italy', [12, 14, 16, 19, 24, 28, 31, 31, 27, 22, 17, 13], [3, 4, 6, 8, 12, 16, 19, 19, 16, 12, 8, 4]),
  P('Milan', 'Italy', [7, 10, 15, 19, 23, 28, 30, 30, 25, 18, 12, 7], [0, 1, 5, 9, 13, 17, 20, 20, 16, 11, 6, 1]),
  P('Venice', 'Italy', [7, 9, 13, 17, 22, 26, 29, 28, 24, 19, 13, 8], [0, 1, 5, 9, 13, 17, 19, 19, 15, 11, 6, 1]),
  P('Florence', 'Italy', [11, 13, 17, 20, 25, 29, 33, 33, 28, 22, 15, 11], [2, 3, 5, 8, 12, 16, 18, 18, 15, 11, 6, 3]),
  P('Naples', 'Italy', [13, 14, 16, 19, 24, 28, 31, 31, 27, 23, 18, 14], [5, 5, 7, 9, 13, 17, 20, 20, 17, 13, 9, 6]),
  P('Barcelona', 'Spain', [15, 15, 17, 19, 22, 26, 28, 29, 26, 23, 18, 15], [8, 9, 10, 12, 15, 19, 22, 22, 19, 16, 11, 9]),
  P('Madrid', 'Spain', [10, 12, 16, 18, 22, 28, 32, 31, 26, 20, 14, 10], [3, 3, 6, 8, 12, 17, 19, 19, 16, 11, 6, 3]),
  P('Seville', 'Spain', [16, 18, 22, 24, 28, 33, 36, 36, 32, 26, 20, 17], [6, 7, 10, 12, 15, 19, 21, 21, 19, 15, 10, 7]),
  P('Lisbon', 'Portugal', [15, 16, 19, 20, 23, 26, 28, 29, 27, 23, 18, 16], [9, 9, 11, 12, 14, 17, 18, 19, 18, 15, 12, 10]),
  P('Porto', 'Portugal', [14, 15, 17, 18, 20, 23, 25, 25, 24, 21, 17, 15], [6, 6, 8, 9, 12, 14, 16, 16, 14, 12, 9, 7]),
  P('Berlin', 'Germany', [3, 5, 9, 15, 19, 22, 24, 24, 19, 14, 8, 4], [-2, -1, 1, 5, 9, 12, 14, 14, 11, 7, 3, 0]),
  P('Munich', 'Germany', [3, 5, 10, 15, 19, 22, 24, 24, 20, 14, 8, 4], [-3, -3, 1, 4, 8, 12, 14, 13, 10, 6, 2, -2]),
  P('Frankfurt', 'Germany', [4, 6, 11, 16, 20, 23, 25, 25, 20, 14, 8, 5], [-1, -1, 2, 5, 9, 12, 14, 14, 10, 7, 3, 0]),
  P('Hamburg', 'Germany', [4, 5, 9, 14, 18, 21, 23, 23, 19, 14, 8, 5], [-1, -1, 1, 4, 8, 11, 13, 13, 10, 7, 3, 0]),
  P('Vienna', 'Austria', [3, 5, 11, 16, 21, 24, 27, 26, 21, 15, 8, 4], [-2, -1, 3, 7, 11, 15, 17, 17, 13, 8, 3, -1]),
  P('Salzburg', 'Austria', [3, 5, 10, 15, 19, 23, 25, 24, 20, 15, 8, 4], [-4, -4, 0, 4, 8, 12, 14, 13, 10, 5, 1, -3]),
  P('Prague', 'Czechia', [2, 4, 9, 15, 19, 23, 25, 25, 20, 14, 7, 3], [-3, -3, 0, 4, 8, 12, 13, 13, 9, 5, 1, -2]),
  P('Budapest', 'Hungary', [2, 6, 11, 17, 22, 25, 28, 27, 22, 16, 8, 3], [-3, -2, 2, 7, 11, 15, 17, 16, 12, 7, 3, -2]),
  P('Warsaw', 'Poland', [0, 2, 7, 14, 19, 22, 24, 24, 18, 12, 6, 2], [-5, -4, -1, 4, 9, 12, 14, 14, 9, 5, 1, -3]),
  P('Krakow', 'Poland', [1, 3, 8, 15, 19, 23, 25, 25, 19, 14, 7, 2], [-5, -4, -1, 4, 8, 12, 14, 13, 9, 4, 0, -4]),
  P('Athens', 'Greece', [13, 14, 17, 20, 25, 30, 33, 33, 29, 24, 19, 15], [7, 7, 9, 12, 16, 20, 23, 23, 20, 16, 12, 9]),
  P('Santorini', 'Greece', [14, 15, 16, 19, 23, 27, 29, 29, 26, 23, 19, 16], [10, 10, 11, 13, 17, 21, 23, 23, 21, 18, 14, 11]),
  P('Copenhagen', 'Denmark', [3, 3, 6, 11, 16, 19, 21, 21, 17, 13, 8, 5], [-1, -1, 0, 4, 8, 11, 14, 14, 11, 7, 4, 1]),
  P('Stockholm', 'Sweden', [1, 1, 5, 11, 16, 21, 23, 22, 17, 10, 5, 2], [-3, -4, -2, 2, 7, 11, 14, 14, 10, 5, 1, -2]),
  P('Oslo', 'Norway', [-1, 0, 5, 11, 17, 21, 23, 21, 16, 9, 4, 0], [-6, -6, -3, 2, 7, 11, 14, 13, 9, 4, -1, -5]),
  P('Helsinki', 'Finland', [-2, -3, 1, 8, 15, 19, 22, 20, 15, 9, 3, 0], [-7, -8, -5, 0, 5, 10, 13, 12, 8, 3, -1, -5]),
  P('Reykjavik', 'Iceland', [2, 3, 3, 6, 9, 12, 14, 13, 11, 7, 4, 3], [-3, -3, -2, 0, 4, 7, 9, 8, 6, 2, -1, -2]),
  P('Moscow', 'Russia', [-4, -3, 3, 11, 19, 22, 24, 22, 16, 9, 1, -3], [-10, -10, -5, 1, 7, 11, 14, 12, 7, 2, -3, -8]),
  // Americas
  P('New York', 'United States', [4, 6, 10, 17, 22, 27, 29, 28, 24, 18, 12, 7], [-3, -2, 2, 7, 13, 18, 21, 21, 17, 10, 5, 0]),
  P('Los Angeles', 'United States', [20, 20, 21, 22, 23, 25, 28, 29, 28, 26, 23, 20], [9, 10, 11, 12, 14, 16, 18, 18, 17, 15, 11, 9]),
  P('San Francisco', 'United States', [14, 16, 17, 18, 19, 21, 22, 22, 23, 21, 17, 14], [8, 9, 9, 10, 11, 12, 13, 14, 14, 12, 10, 8]),
  P('Las Vegas', 'United States', [14, 17, 22, 26, 32, 38, 41, 40, 35, 27, 19, 14], [3, 5, 9, 13, 19, 24, 28, 27, 22, 15, 8, 3]),
  P('Chicago', 'United States', [0, 2, 9, 16, 22, 27, 29, 28, 24, 17, 9, 2], [-8, -6, -1, 5, 11, 16, 19, 19, 14, 8, 1, -5]),
  P('Washington, D.C.', 'United States', [7, 9, 14, 20, 25, 30, 32, 31, 27, 21, 14, 9], [-2, -1, 3, 8, 14, 19, 22, 21, 17, 10, 4, 0]),
  P('Boston', 'United States', [2, 4, 8, 14, 20, 25, 28, 27, 23, 17, 11, 5], [-6, -5, -1, 5, 10, 15, 19, 18, 14, 8, 3, -3]),
  P('Seattle', 'United States', [8, 9, 12, 15, 18, 21, 24, 25, 21, 15, 10, 8], [3, 2, 4, 6, 8, 11, 13, 13, 11, 8, 4, 2]),
  P('Orlando', 'United States', [22, 24, 26, 29, 32, 33, 34, 33, 32, 29, 26, 23], [10, 12, 14, 16, 20, 23, 23, 23, 23, 19, 14, 11]),
  P('Miami', 'United States', [24, 25, 26, 28, 30, 32, 32, 32, 31, 29, 27, 25], [16, 17, 19, 21, 23, 25, 26, 26, 25, 23, 20, 18]),
  P('Honolulu', 'United States', [27, 27, 27, 28, 29, 30, 31, 31, 31, 30, 29, 27], [19, 19, 20, 21, 22, 23, 24, 24, 23, 22, 21, 20]),
  P('Vancouver', 'Canada', [7, 8, 10, 13, 16, 19, 22, 22, 19, 13, 9, 6], [1, 1, 3, 5, 8, 11, 13, 13, 10, 7, 3, 1]),
  P('Toronto', 'Canada', [-1, 0, 5, 12, 19, 24, 27, 26, 22, 14, 7, 2], [-7, -6, -2, 4, 10, 15, 18, 17, 13, 7, 1, -4]),
  P('Mexico City', 'Mexico', [22, 24, 26, 27, 27, 25, 24, 24, 23, 23, 23, 22], [6, 7, 9, 11, 12, 13, 12, 12, 12, 10, 8, 7]),
  P('Cancún', 'Mexico', [28, 29, 30, 31, 32, 33, 33, 33, 32, 31, 30, 28], [20, 20, 21, 23, 24, 25, 25, 24, 24, 23, 22, 21]),
  P('Rio de Janeiro', 'Brazil', [30, 31, 30, 28, 27, 26, 26, 26, 26, 27, 28, 29], [23, 24, 23, 22, 20, 19, 18, 19, 19, 20, 21, 22]),
  P('Buenos Aires', 'Argentina', [30, 29, 26, 23, 19, 16, 15, 17, 19, 22, 25, 28], [20, 19, 17, 14, 11, 8, 8, 9, 11, 13, 16, 18]),
  // Australia and New Zealand
  P('Sydney', 'Australia', [26, 26, 25, 23, 20, 18, 17, 19, 21, 23, 24, 26], [19, 19, 18, 15, 12, 9, 8, 9, 11, 14, 16, 18]),
  P('Melbourne', 'Australia', [26, 26, 24, 20, 17, 14, 14, 15, 17, 20, 22, 24], [14, 15, 13, 11, 9, 7, 6, 7, 8, 10, 11, 13]),
  P('Perth', 'Australia', [32, 32, 30, 26, 22, 19, 18, 19, 20, 23, 27, 29], [18, 18, 17, 14, 11, 9, 8, 8, 10, 12, 14, 16]),
  P('Brisbane', 'Australia', [30, 29, 28, 26, 24, 21, 21, 22, 25, 27, 28, 29], [21, 21, 20, 17, 14, 11, 10, 11, 14, 16, 18, 20]),
  P('Gold Coast', 'Australia', [29, 29, 28, 26, 24, 22, 21, 22, 24, 25, 27, 28], [21, 21, 20, 17, 14, 12, 11, 12, 14, 16, 18, 20]),
  P('Cairns', 'Australia', [31, 31, 30, 29, 28, 26, 26, 27, 28, 29, 31, 31], [24, 24, 23, 22, 20, 18, 17, 17, 18, 20, 22, 23]),
  P('Auckland', 'New Zealand', [24, 25, 24, 21, 19, 16, 15, 16, 17, 19, 21, 23], [16, 17, 15, 13, 11, 9, 8, 8, 10, 11, 13, 15]),
  P('Queenstown', 'New Zealand', [22, 22, 19, 15, 11, 8, 8, 10, 13, 16, 18, 21], [10, 10, 8, 5, 2, -1, -2, -1, 2, 4, 6, 8]),
  P('Christchurch', 'New Zealand', [23, 22, 20, 17, 14, 11, 11, 12, 15, 17, 19, 21], [12, 12, 10, 7, 4, 2, 2, 3, 5, 7, 9, 11]),
  P('Wellington', 'New Zealand', [21, 21, 20, 17, 15, 13, 12, 13, 14, 16, 17, 19], [14, 14, 13, 11, 9, 7, 6, 7, 8, 9, 11, 13]),
];

const plain = (value: string) => value.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();

/** Other names people type for the places above, and a few countries by the city most trips go to. */
const ALIASES: Record<string, string> = {
  hokkaido: 'Sapporo', niseko: 'Sapporo', yokohama: 'Tokyo', kamakura: 'Tokyo', nara: 'Kyoto', kobe: 'Osaka', naha: 'Okinawa',
  mecca: 'Makkah', mekkah: 'Makkah', medina: 'Madinah', madina: 'Madinah', 'hong kong sar': 'Hong Kong', shenzhen: 'Guangzhou',
  denpasar: 'Bali', ubud: 'Bali', seminyak: 'Bali', kuta: 'Bali', canggu: 'Bali', 'nusa dua': 'Bali', jogja: 'Yogyakarta', yogya: 'Yogyakarta',
  jogjakarta: 'Yogyakarta', mataram: 'Lombok', gili: 'Lombok', komodo: 'Labuan Bajo', flores: 'Labuan Bajo', puncak: 'Bandung', lembang: 'Bandung', sorong: 'Raja Ampat',
  saigon: 'Ho Chi Minh City', 'ho chi minh': 'Ho Chi Minh City', hcmc: 'Ho Chi Minh City', 'hoi an': 'Da Nang', samui: 'Ko Samui', 'koh samui': 'Ko Samui',
  'phi phi': 'Krabi', 'ao nang': 'Krabi', boracay: 'Cebu', kl: 'Kuala Lumpur', melaka: 'Malacca', 'johor bahru': 'Singapore', 'cameron highlands': 'Genting Highlands',
  male: 'Maldives', 'new delhi': 'Delhi', nyc: 'New York', 'washington dc': 'Washington, D.C.', washington: 'Washington, D.C.', hawaii: 'Honolulu', rio: 'Rio de Janeiro',
  cancun: 'Cancún', goreme: 'Cappadocia', xian: 'Xi’an', 'xi an': 'Xi’an',
  japan: 'Tokyo', korea: 'Seoul', 'south korea': 'Seoul', taiwan: 'Taipei', china: 'Beijing', thailand: 'Bangkok', malaysia: 'Kuala Lumpur', philippines: 'Manila',
  cambodia: 'Siem Reap', laos: 'Luang Prabang', 'sri lanka': 'Colombo', nepal: 'Kathmandu', india: 'Delhi', 'saudi arabia': 'Makkah', uae: 'Dubai', qatar: 'Doha',
  oman: 'Muscat', jordan: 'Amman', turkey: 'Istanbul', turkiye: 'Istanbul', egypt: 'Cairo', morocco: 'Marrakech', 'south africa': 'Cape Town',
  england: 'London', uk: 'London', 'united kingdom': 'London', scotland: 'Edinburgh', ireland: 'Dublin', france: 'Paris', netherlands: 'Amsterdam', holland: 'Amsterdam',
  belgium: 'Brussels', switzerland: 'Zurich', italy: 'Rome', spain: 'Madrid', portugal: 'Lisbon', germany: 'Berlin', austria: 'Vienna', czechia: 'Prague',
  'czech republic': 'Prague', hungary: 'Budapest', poland: 'Warsaw', greece: 'Athens', denmark: 'Copenhagen', sweden: 'Stockholm', norway: 'Oslo',
  finland: 'Helsinki', iceland: 'Reykjavik', russia: 'Moscow', canada: 'Toronto', mexico: 'Mexico City', brazil: 'Rio de Janeiro', argentina: 'Buenos Aires',
  australia: 'Sydney', 'new zealand': 'Auckland',
};

const BY_KEY = new Map<string, KnownPlace>([
  ...KNOWN_PLACES.map((place) => [plain(place.name), place] as const),
  ...Object.entries(ALIASES).map(([alias, name]) => [plain(alias), KNOWN_PLACES.find((place) => place.name === name)!] as const),
]);
const KEYS = [...BY_KEY.keys()].sort((a, b) => b.length - a.length);

/** The listed place a typed one is ("Tokyo", "Kyoto, Japan", "Ubud"), or null. */
export function normalsFor(place: string): KnownPlace | null {
  const words = plain(place);
  if (!words) return null;
  const key = KEYS.find((item) => words === item || ` ${words} `.includes(` ${item} `));
  return key ? BY_KEY.get(key) ?? null : null;
}

/** Listed places matching what's typed, by name or country; names that start with it come first. */
export function suggestPlaces(typed: string, skip: readonly string[] = [], limit = 8) {
  const query = plain(typed);
  const taken = new Set(skip.map(plain));
  const open = KNOWN_PLACES.filter((place) => !taken.has(plain(place.name)));
  if (!query) return open.slice(0, limit);
  const rank = (place: KnownPlace) => {
    const name = plain(place.name);
    return name.startsWith(query) ? 0 : name.includes(query) ? 1 : plain(place.country).includes(query) ? 2 : 3;
  };
  return open.map((place) => ({ place, rank: rank(place) })).filter((item) => item.rank < 3).sort((a, b) => a.rank - b.rank).slice(0, limit).map((item) => item.place);
}

/** The months (0–11) a trip touches, from the day it leaves to the day it comes back. */
function monthsOf(start: number, end: number) {
  const months: number[] = [];
  const at = new Date(start);
  const last = new Date(end);
  for (let year = at.getFullYear(), month = at.getMonth(); year < last.getFullYear() || (year === last.getFullYear() && month <= last.getMonth()); month = (month + 1) % 12, year += month === 0 ? 1 : 0) {
    months.push(month);
    if (months.length >= 12) break;
  }
  return months;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export type ClimateGuess = { climate: Climate; low: number; high: number; places: string[]; months: string };

/**
 * What the weather is likely to be, from the listed places and the months the trip touches: cold
 * when days usually reach 14°C or less, warm from 24°C, some of each between (or when one place is
 * much warmer than another). Null without dates or a listed place.
 */
export function guessClimate(places: readonly string[], startDate: number | null, endDate: number | null): ClimateGuess | null {
  if (startDate === null) return null;
  const months = monthsOf(startDate, endDate ?? startDate);
  const found = [...new Map(places.map(normalsFor).filter((item): item is KnownPlace => item !== null).map((item) => [item.name, item])).values()];
  if (!found.length || !months.length) return null;
  const highs = found.map((item) => months.reduce((sum, month) => sum + item.high[month], 0) / months.length);
  const high = Math.max(...found.flatMap((item) => months.map((month) => item.high[month])));
  const low = Math.min(...found.flatMap((item) => months.map((month) => item.low[month])));
  const average = highs.reduce((sum, value) => sum + value, 0) / highs.length;
  const climate: Climate = Math.max(...highs) - Math.min(...highs) >= 10 ? 'mixed' : average <= 14 ? 'cold' : average >= 24 ? 'warm' : 'mixed';
  const label = months.length > 1 ? `${MONTHS[months[0]]}–${MONTHS[months[months.length - 1]]}` : MONTHS[months[0]];
  return { climate, low, high, places: found.map((item) => item.name), months: label };
}

/** "usually 9–17°C in Nov", to follow other words or open a line with its first letter raised. */
export const guessText = (guess: ClimateGuess) => `usually ${guess.low}–${guess.high}°C in ${guess.months}`;
