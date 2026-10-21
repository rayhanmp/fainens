/**
 * Places people often travel to, for picking where a trip goes, each with its usual daily highs
 * and lows (°C, January to December, rounded) so a trip's weather can be guessed from where it
 * goes and when. Each place's figures are the mean daily maximum and minimum from the climate
 * table in its English Wikipedia article, from the weather service or source named with it, and
 * for the period named (1991–2020 normals where the table has them). They say what a month is
 * usually like, not a forecast.
 */

export type Climate = 'cold' | 'warm' | 'mixed';
export const WEATHER: Record<Climate, string> = { cold: 'Cold', warm: 'Warm', mixed: 'Some of each' };
export type KnownPlace = { name: string; country: string; high: number[]; low: number[]; source: string };

const P = (name: string, country: string, high: number[], low: number[], source: string): KnownPlace => ({ name, country, high, low, source });

/** Roughly by how often people go, so the list opens with the likeliest. */
export const KNOWN_PLACES: KnownPlace[] = [
  // Japan
  P('Tokyo', 'Japan', [10, 11, 14, 19, 24, 26, 30, 31, 28, 22, 17, 12], [1, 2, 5, 10, 15, 19, 22, 24, 20, 15, 9, 4], 'Japan Meteorological Agency, 1991–2020'),
  P('Osaka', 'Japan', [10, 11, 14, 20, 25, 28, 32, 34, 30, 24, 18, 12], [3, 3, 6, 11, 16, 20, 25, 26, 22, 16, 10, 5], 'Japan Meteorological Agency, 1991–2020'),
  P('Kyoto', 'Japan', [9, 10, 14, 20, 25, 28, 32, 34, 29, 23, 17, 12], [2, 2, 4, 9, 15, 19, 24, 25, 21, 14, 8, 4], 'Japan Meteorological Agency, 1991–2020'),
  P('Sapporo', 'Japan', [0, 0, 5, 12, 18, 22, 25, 26, 23, 16, 9, 2], [-6, -6, -2, 3, 9, 13, 18, 19, 15, 8, 2, -4], 'Japan Meteorological Agency, 1991–2020'),
  P('Fukuoka', 'Japan', [10, 12, 15, 20, 24, 27, 31, 33, 29, 24, 18, 13], [4, 4, 7, 12, 16, 20, 25, 25, 22, 16, 11, 6], 'Japan Meteorological Agency, 1991–2020'),
  P('Nagoya', 'Japan', [9, 11, 15, 20, 25, 28, 31, 33, 29, 23, 17, 12], [1, 1, 5, 10, 15, 19, 24, 25, 21, 15, 9, 3], 'Japan Meteorological Agency, 1991–2020'),
  P('Hiroshima', 'Japan', [10, 11, 15, 20, 24, 27, 31, 33, 29, 24, 18, 12], [2, 2, 5, 10, 15, 20, 24, 25, 21, 15, 9, 4], 'Japan Meteorological Agency, 1991–2020'),
  P('Kanazawa', 'Japan', [7, 8, 12, 17, 22, 26, 30, 31, 27, 22, 16, 10], [1, 1, 3, 8, 14, 18, 23, 24, 20, 14, 8, 4], 'Japan Meteorological Agency, 1991–2020'),
  P('Okinawa', 'Japan', [20, 20, 22, 24, 27, 30, 32, 32, 31, 28, 25, 22], [15, 15, 17, 19, 22, 25, 27, 27, 26, 24, 20, 17], 'Japan Meteorological Agency, 1991–2020'),
  // Korea, China, Taiwan
  P('Seoul', 'South Korea', [2, 5, 11, 18, 24, 28, 29, 30, 26, 20, 12, 4], [-6, -3, 2, 8, 14, 19, 22, 23, 18, 11, 4, -3], 'Korea Meteorological Administration, 1991–2020'),
  P('Busan', 'South Korea', [8, 10, 14, 18, 22, 25, 28, 30, 26, 23, 17, 10], [0, 2, 5, 10, 15, 18, 22, 24, 20, 15, 8, 2], 'Korea Meteorological Administration, 1991–2020'),
  P('Jeju', 'South Korea', [9, 10, 13, 18, 22, 25, 29, 30, 26, 22, 16, 11], [4, 4, 7, 11, 15, 19, 24, 25, 21, 16, 10, 6], 'Korea Meteorological Administration, 1991–2020'),
  P('Beijing', 'China', [2, 6, 13, 21, 27, 31, 32, 31, 27, 19, 10, 4], [-7, -4, 2, 9, 15, 20, 23, 22, 16, 9, 1, -5], 'China Meteorological Administration, 1991–2020'),
  P('Shanghai', 'China', [9, 11, 15, 21, 26, 29, 33, 33, 29, 24, 18, 11], [3, 4, 8, 13, 18, 22, 26, 26, 23, 17, 11, 5], 'China Meteorological Administration, 1991–2020'),
  P('Guangzhou', 'China', [19, 20, 22, 26, 30, 32, 33, 33, 32, 29, 25, 21], [11, 13, 16, 20, 23, 25, 26, 26, 24, 21, 17, 12], 'China Meteorological Administration, 1991–2020'),
  P('Chengdu', 'China', [10, 13, 18, 23, 27, 29, 31, 31, 26, 21, 17, 11], [3, 6, 9, 14, 18, 21, 23, 22, 19, 15, 10, 5], 'China Meteorological Administration, 1991–2020'),
  P('Xi’an', 'China', [5, 9, 16, 22, 27, 32, 33, 31, 25, 19, 13, 7], [-4, -1, 4, 9, 14, 19, 22, 21, 16, 10, 3, -3], 'China Meteorological Administration, 1991–2020'),
  P('Harbin', 'China', [-12, -6, 3, 14, 22, 27, 28, 27, 22, 13, 0, -10], [-22, -18, -8, 2, 10, 16, 19, 17, 10, 2, -9, -19], 'China Meteorological Administration, 1991–2020'),
  P('Hong Kong', 'China', [19, 19, 22, 26, 29, 31, 32, 31, 31, 28, 25, 20], [15, 15, 18, 21, 25, 27, 27, 27, 26, 24, 20, 16], 'Hong Kong Observatory, 1991–2020'),
  P('Macau', 'China', [19, 19, 21, 25, 29, 31, 31, 32, 31, 29, 25, 20], [13, 14, 17, 20, 24, 26, 26, 26, 25, 23, 19, 14], 'Macao Meteorological and Geophysical Bureau, 1991–2020'),
  P('Taipei', 'Taiwan', [19, 20, 23, 26, 30, 33, 35, 34, 32, 28, 25, 21], [14, 14, 16, 19, 23, 25, 27, 26, 25, 22, 20, 16], 'Central Weather Bureau, 1991–2020'),
  // Southeast Asia
  P('Singapore', 'Singapore', [31, 32, 32, 32, 32, 32, 31, 31, 32, 32, 31, 31], [24, 25, 25, 25, 26, 26, 25, 25, 25, 25, 25, 24], 'National Environment Agency, 1991–2020'),
  P('Kuala Lumpur', 'Malaysia', [33, 33, 34, 34, 34, 33, 33, 33, 33, 33, 32, 32], [24, 24, 25, 25, 25, 25, 24, 25, 24, 24, 24, 24], 'World Meteorological Organization, 1991–2020'),
  P('Penang', 'Malaysia', [32, 32, 33, 32, 32, 32, 32, 31, 31, 31, 31, 31], [25, 25, 25, 25, 25, 25, 25, 25, 24, 24, 24, 25], 'World Meteorological Organization, 1991–2020'),
  P('Langkawi', 'Malaysia', [33, 33, 33, 32, 32, 32, 31, 31, 31, 31, 31, 32], [24, 24, 25, 25, 25, 25, 25, 25, 24, 24, 25, 24], 'Malaysian Meteorological Department'),
  P('Malacca', 'Malaysia', [32, 33, 33, 33, 33, 32, 32, 32, 32, 32, 32, 31], [24, 24, 24, 25, 25, 24, 24, 24, 24, 24, 24, 24], 'World Meteorological Organization, 1991–2020'),
  P('Kota Kinabalu', 'Malaysia', [31, 31, 32, 33, 33, 33, 32, 32, 32, 32, 32, 32], [24, 24, 24, 25, 25, 24, 24, 24, 24, 24, 24, 24], 'World Meteorological Organization, 1991–2020'),
  P('Genting Highlands', 'Malaysia', [20, 21, 22, 22, 22, 22, 22, 22, 21, 21, 21, 21], [12, 12, 12, 13, 13, 13, 13, 13, 13, 13, 13, 12], 'Climate-Data.org, modelled estimates'),
  P('Bangkok', 'Thailand', [33, 34, 35, 36, 35, 34, 34, 33, 33, 33, 33, 32], [23, 25, 26, 27, 27, 26, 26, 26, 25, 25, 25, 23], 'NOAA, 1991–2020'),
  P('Phuket', 'Thailand', [33, 34, 34, 34, 33, 33, 32, 32, 32, 32, 32, 32], [25, 25, 26, 26, 26, 26, 26, 26, 25, 25, 25, 25], 'World Meteorological Organization, 1991–2020'),
  P('Chiang Mai', 'Thailand', [30, 33, 35, 37, 35, 33, 32, 32, 32, 32, 31, 29], [16, 17, 20, 23, 24, 25, 24, 24, 24, 23, 20, 17], 'World Meteorological Organization, 1991–2020'),
  P('Krabi', 'Thailand', [33, 34, 34, 34, 33, 32, 32, 31, 31, 31, 31, 31], [22, 22, 23, 24, 24, 23, 23, 23, 23, 22, 23, 22], 'Thai Meteorological Department, 1981–2010'),
  P('Pattaya', 'Thailand', [31, 31, 32, 33, 33, 32, 32, 31, 31, 31, 31, 30], [24, 25, 26, 26, 27, 26, 26, 26, 25, 25, 24, 23], 'World Meteorological Organization, 1991–2020'),
  P('Ko Samui', 'Thailand', [29, 29, 30, 32, 33, 33, 32, 32, 32, 31, 30, 29], [24, 25, 25, 26, 26, 25, 25, 25, 25, 24, 24, 24], 'World Meteorological Organization, 1991–2020'),
  P('Hanoi', 'Vietnam', [20, 22, 26, 29, 33, 35, 34, 33, 32, 30, 27, 21], [14, 16, 21, 22, 25, 27, 27, 26, 25, 23, 20, 14], 'Vietnam Institute for Building Science and Technology, 1991–2020'),
  P('Ho Chi Minh City', 'Vietnam', [32, 33, 34, 35, 35, 34, 33, 33, 33, 32, 32, 32], [23, 23, 25, 26, 26, 26, 25, 25, 25, 25, 25, 24], 'Vietnam Institute for Building Science and Technology'),
  P('Da Nang', 'Vietnam', [25, 26, 28, 31, 33, 35, 34, 34, 32, 30, 27, 25], [19, 20, 22, 24, 25, 26, 26, 26, 25, 24, 22, 20], 'Vietnam Institute for Building Science and Technology'),
  P('Nha Trang', 'Vietnam', [27, 28, 29, 31, 32, 33, 33, 33, 32, 30, 29, 27], [21, 22, 23, 25, 26, 26, 26, 26, 25, 24, 24, 22], 'Vietnam Institute for Building Science and Technology'),
  P('Siem Reap', 'Cambodia', [32, 34, 35, 36, 35, 34, 33, 32, 32, 32, 31, 31], [20, 22, 24, 25, 25, 25, 25, 25, 25, 25, 23, 21], 'Deutscher Wetterdienst, 1997–2010'),
  P('Phnom Penh', 'Cambodia', [32, 33, 35, 35, 35, 34, 33, 33, 32, 31, 31, 31], [22, 23, 24, 26, 26, 25, 25, 25, 24, 24, 23, 22], 'Deutscher Wetterdienst, 1988–2013'),
  P('Luang Prabang', 'Laos', [28, 32, 34, 35, 35, 34, 32, 32, 33, 32, 30, 27], [15, 15, 18, 22, 23, 24, 24, 24, 23, 21, 18, 15], 'World Meteorological Organization, 1991–2020'),
  P('Manila', 'Philippines', [30, 31, 32, 34, 34, 33, 32, 31, 31, 31, 31, 30], [24, 24, 25, 27, 27, 27, 26, 26, 26, 26, 25, 25], 'PAGASA, 1991–2020'),
  P('Cebu', 'Philippines', [30, 30, 31, 32, 33, 32, 32, 32, 32, 31, 31, 30], [24, 24, 25, 26, 26, 26, 25, 25, 25, 25, 25, 25], 'PAGASA, 1991–2020'),
  // Indonesia
  P('Bali', 'Indonesia', [31, 31, 31, 31, 31, 30, 29, 29, 30, 31, 32, 31], [25, 25, 25, 25, 25, 25, 24, 24, 24, 25, 25, 25], 'Starlings Roost Weather, 1991–2020'),
  P('Jakarta', 'Indonesia', [31, 31, 32, 33, 33, 33, 33, 33, 33, 33, 33, 32], [25, 25, 26, 26, 26, 26, 25, 25, 26, 26, 26, 26], 'World Meteorological Organization, 1991–2020'),
  P('Bandung', 'Indonesia', [28, 28, 29, 29, 29, 29, 29, 29, 30, 30, 29, 29], [20, 20, 20, 21, 20, 20, 19, 19, 19, 20, 20, 20], 'Meteomanz, 2013–2023'),
  P('Yogyakarta', 'Indonesia', [30, 31, 31, 32, 31, 31, 30, 31, 32, 32, 31, 30], [23, 23, 23, 23, 23, 22, 21, 21, 22, 23, 23, 23], 'Climate-Data.org, modelled estimates'),
  P('Surabaya', 'Indonesia', [32, 32, 32, 32, 32, 31, 31, 31, 32, 34, 34, 33], [25, 25, 25, 25, 25, 24, 23, 23, 23, 25, 25, 25], 'Starlings Roost Weather, 1991–2020'),
  P('Malang', 'Indonesia', [27, 27, 28, 28, 28, 28, 27, 28, 29, 30, 28, 27], [22, 22, 22, 21, 21, 20, 19, 19, 20, 21, 22, 22], 'World Meteorological Organization, 1991–2020'),
  P('Lombok', 'Indonesia', [31, 31, 31, 31, 31, 30, 30, 30, 31, 31, 31, 31], [22, 23, 22, 22, 21, 20, 19, 20, 21, 22, 23, 23], 'Climate-Data.org, modelled estimates'),
  P('Labuan Bajo', 'Indonesia', [30, 30, 31, 31, 31, 30, 30, 31, 32, 32, 32, 31], [21, 21, 21, 21, 20, 19, 18, 18, 19, 20, 22, 21], 'Climate-Data.org, modelled estimates'),
  P('Medan', 'Indonesia', [31, 32, 33, 33, 33, 33, 33, 32, 32, 31, 31, 31], [23, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24], 'Starlings Roost Weather, 1991–2020'),
  P('Makassar', 'Indonesia', [31, 31, 32, 32, 32, 32, 32, 32, 33, 33, 33, 31], [25, 25, 25, 25, 25, 25, 24, 24, 24, 25, 25, 25], 'World Meteorological Organization, 1991–2020'),
  P('Raja Ampat', 'Indonesia', [31, 31, 31, 31, 31, 30, 29, 30, 30, 31, 31, 31], [24, 24, 25, 25, 25, 24, 24, 24, 24, 24, 25, 25], 'Climate-Data.org, modelled estimates'),
  // South Asia and the Indian Ocean
  P('Maldives', 'Maldives', [31, 31, 32, 32, 32, 31, 31, 31, 31, 31, 30, 30], [26, 26, 27, 27, 27, 26, 26, 26, 26, 26, 26, 26], 'World Meteorological Organization, 1991–2020'),
  P('Colombo', 'Sri Lanka', [31, 32, 32, 32, 32, 31, 30, 30, 30, 30, 31, 31], [23, 24, 25, 25, 26, 26, 26, 26, 25, 25, 24, 24], 'NOAA, 1991–2020'),
  P('Kathmandu', 'Nepal', [19, 22, 26, 29, 29, 30, 29, 29, 29, 27, 24, 20], [3, 5, 9, 12, 16, 19, 20, 20, 19, 14, 8, 4], 'World Meteorological Organization, 1991–2020'),
  P('Delhi', 'India', [20, 24, 30, 37, 40, 39, 36, 34, 34, 33, 28, 23], [8, 11, 16, 21, 26, 28, 28, 27, 25, 20, 13, 8], 'India Meteorological Department, 1991–2020'),
  P('Mumbai', 'India', [31, 32, 33, 33, 34, 33, 30, 30, 31, 34, 34, 33], [17, 18, 21, 24, 27, 27, 26, 25, 25, 24, 21, 18], 'India Meteorological Department, 1991–2020'),
  // Middle East and Africa
  P('Makkah', 'Saudi Arabia', [31, 33, 35, 39, 42, 44, 43, 43, 43, 40, 36, 33], [19, 20, 22, 25, 28, 29, 30, 30, 29, 27, 23, 21], 'NOAA, 1991–2020'),
  P('Madinah', 'Saudi Arabia', [24, 27, 31, 36, 40, 43, 43, 44, 42, 37, 30, 26], [12, 14, 17, 22, 26, 29, 30, 31, 29, 24, 18, 14], 'World Meteorological Organization, 1991–2020'),
  P('Jeddah', 'Saudi Arabia', [29, 30, 32, 35, 37, 38, 39, 39, 37, 37, 33, 31], [19, 19, 20, 23, 25, 26, 28, 29, 27, 25, 23, 21], 'NOAA, 1991–2020'),
  P('Dubai', 'United Arab Emirates', [24, 26, 29, 34, 38, 40, 42, 42, 40, 36, 31, 27], [15, 16, 19, 22, 26, 28, 31, 32, 29, 25, 21, 17], 'NOAA, 1991–2020'),
  P('Abu Dhabi', 'United Arab Emirates', [25, 27, 30, 35, 40, 41, 43, 43, 41, 37, 31, 27], [14, 16, 18, 21, 25, 27, 30, 30, 27, 24, 20, 16], 'NOAA, 1991–2020'),
  P('Doha', 'Qatar', [23, 24, 28, 33, 39, 42, 42, 41, 39, 36, 30, 25], [15, 16, 19, 23, 28, 31, 32, 32, 30, 27, 22, 17], 'Qatar Meteorological Department, 1992–2021'),
  P('Muscat', 'Oman', [25, 26, 29, 35, 40, 39, 37, 36, 36, 35, 30, 27], [17, 18, 20, 25, 29, 30, 30, 28, 27, 25, 21, 18], 'NOAA, 1991–2020'),
  P('Amman', 'Jordan', [13, 14, 18, 24, 28, 31, 33, 33, 31, 27, 20, 15], [4, 5, 8, 11, 15, 19, 21, 21, 19, 15, 10, 6], 'Jordan Meteorological Department, 1989–2018'),
  P('Jerusalem', 'Palestine and Israel', [13, 14, 17, 22, 26, 29, 30, 30, 29, 26, 20, 15], [7, 7, 10, 13, 16, 18, 20, 20, 19, 17, 13, 9], 'NOAA, 1991–2020'),
  P('Istanbul', 'Türkiye', [9, 9, 12, 16, 21, 26, 28, 28, 25, 20, 15, 11], [4, 4, 5, 8, 13, 17, 20, 21, 17, 14, 9, 6], 'Turkish State Meteorological Service, 1991–2020'),
  P('Cappadocia', 'Türkiye', [4, 6, 11, 16, 21, 26, 29, 29, 25, 19, 12, 6], [-4, -3, 1, 5, 9, 12, 15, 15, 11, 7, 2, -1], 'Turkish State Meteorological Service, 1991–2020'),
  P('Antalya', 'Türkiye', [15, 16, 18, 22, 26, 32, 35, 35, 32, 27, 22, 17], [6, 7, 8, 11, 16, 20, 23, 24, 20, 16, 11, 8], 'Turkish State Meteorological Service, 1991–2020'),
  P('Cairo', 'Egypt', [19, 21, 24, 28, 32, 35, 35, 35, 33, 30, 25, 21], [10, 11, 13, 16, 19, 22, 24, 24, 23, 20, 16, 12], 'NOAA, 1991–2020'),
  P('Marrakech', 'Morocco', [19, 21, 24, 26, 29, 34, 38, 37, 33, 29, 23, 20], [6, 8, 10, 12, 15, 18, 21, 21, 19, 16, 11, 7], 'NOAA, 1991–2020'),
  P('Cape Town', 'South Africa', [27, 27, 26, 24, 21, 18, 18, 18, 20, 22, 24, 26], [17, 17, 15, 12, 10, 8, 7, 8, 9, 12, 13, 16], 'NOAA, 1991–2020'),
  // Europe
  P('London', 'United Kingdom', [8, 9, 12, 15, 18, 22, 24, 23, 20, 16, 12, 9], [3, 3, 4, 6, 9, 12, 14, 14, 12, 9, 5, 3], 'Met Office, 1991–2020'),
  P('Edinburgh', 'United Kingdom', [7, 8, 10, 12, 15, 17, 19, 19, 17, 13, 10, 7], [2, 2, 3, 5, 7, 10, 12, 12, 10, 7, 4, 2], 'Met Office, 1991–2020'),
  P('Manchester', 'United Kingdom', [7, 8, 10, 13, 16, 19, 21, 21, 18, 14, 10, 7], [2, 2, 4, 5, 8, 10, 13, 13, 10, 7, 4, 2], 'Starlings Roost Weather, 1991–2020'),
  P('Dublin', 'Ireland', [9, 9, 11, 13, 15, 18, 20, 20, 17, 14, 11, 9], [4, 4, 5, 7, 9, 12, 14, 13, 11, 9, 6, 4], 'Met Éireann, 1991–2020'),
  P('Paris', 'France', [8, 9, 13, 17, 20, 23, 26, 26, 22, 17, 11, 8], [3, 3, 6, 8, 11, 14, 16, 16, 13, 10, 6, 4], 'Météo-France, 1991–2020'),
  P('Nice', 'France', [13, 14, 15, 17, 21, 25, 28, 28, 25, 21, 17, 14], [6, 6, 8, 11, 15, 18, 21, 21, 18, 14, 10, 7], 'Météo-France, 1991–2020'),
  P('Lyon', 'France', [7, 9, 14, 17, 22, 26, 28, 28, 23, 18, 11, 8], [1, 1, 4, 7, 11, 15, 17, 17, 13, 10, 5, 2], 'Meteociel, 1991–2020'),
  P('Amsterdam', 'Netherlands', [6, 7, 10, 14, 18, 20, 23, 22, 19, 15, 10, 7], [1, 1, 3, 5, 9, 11, 14, 13, 11, 8, 5, 2], 'Royal Netherlands Meteorological Institute, 1991–2020'),
  P('Brussels', 'Belgium', [6, 7, 11, 15, 18, 21, 23, 23, 20, 15, 10, 7], [1, 2, 4, 6, 9, 12, 14, 14, 11, 8, 5, 2], 'Royal Meteorological Institute of Belgium, 1991–2020'),
  P('Zurich', 'Switzerland', [4, 5, 10, 15, 19, 22, 24, 24, 19, 14, 8, 4], [-1, -1, 2, 5, 9, 13, 14, 14, 11, 7, 3, -1], 'NOAA, 1991–2020'),
  P('Geneva', 'Switzerland', [5, 7, 12, 16, 20, 24, 27, 26, 21, 16, 9, 6], [-1, -1, 2, 5, 9, 13, 15, 14, 11, 7, 3, 0], 'NOAA, 1991–2020'),
  P('Lucerne', 'Switzerland', [4, 6, 11, 15, 19, 23, 25, 24, 20, 14, 8, 5], [-2, -2, 2, 5, 9, 13, 15, 14, 11, 7, 2, -1], 'NOAA, 1991–2020'),
  P('Interlaken', 'Switzerland', [3, 5, 11, 15, 19, 22, 24, 24, 19, 14, 8, 4], [-3, -3, 1, 4, 8, 12, 14, 14, 10, 6, 1, -2], 'NOAA, 1991–2020'),
  P('Rome', 'Italy', [13, 14, 17, 20, 25, 30, 33, 33, 28, 23, 17, 13], [3, 3, 6, 8, 13, 17, 19, 20, 16, 12, 8, 4], 'ISPRA, 1991–2020'),
  P('Milan', 'Italy', [7, 10, 16, 19, 24, 28, 31, 30, 26, 19, 12, 7], [0, 1, 4, 8, 13, 17, 19, 19, 15, 10, 5, 1], 'NOAA NCEI, 1991–2020'),
  P('Venice', 'Italy', [8, 9, 13, 17, 22, 26, 29, 28, 24, 19, 13, 8], [0, 1, 5, 9, 14, 17, 19, 19, 15, 11, 6, 1], 'ISPRA, 1991–2020'),
  P('Florence', 'Italy', [11, 13, 16, 20, 24, 29, 32, 32, 27, 22, 16, 11], [2, 3, 5, 8, 12, 16, 18, 19, 15, 11, 6, 3], 'NOAA, 1991–2020'),
  P('Naples', 'Italy', [13, 14, 16, 19, 24, 28, 30, 31, 27, 23, 18, 14], [5, 5, 7, 10, 14, 18, 21, 21, 18, 14, 10, 6], 'ISPRA, 1991–2020'),
  P('Barcelona', 'Spain', [14, 15, 16, 19, 22, 26, 28, 29, 26, 22, 18, 15], [6, 6, 8, 10, 14, 18, 21, 21, 18, 14, 9, 6], 'AEMET, 1991–2020'),
  P('Madrid', 'Spain', [10, 12, 16, 19, 23, 29, 33, 32, 27, 20, 14, 10], [3, 4, 6, 8, 12, 17, 20, 19, 16, 11, 6, 4], 'AEMET, 1991–2020'),
  P('Seville', 'Spain', [16, 18, 22, 24, 28, 33, 36, 36, 32, 26, 20, 17], [6, 7, 10, 12, 15, 19, 21, 21, 18, 15, 10, 7], 'AEMET, 1991–2020'),
  P('Lisbon', 'Portugal', [15, 16, 19, 20, 23, 26, 28, 29, 27, 23, 18, 15], [9, 9, 11, 12, 14, 17, 18, 19, 18, 15, 12, 9], 'IPMA, 1991–2020'),
  P('Porto', 'Portugal', [14, 15, 17, 18, 20, 23, 24, 25, 24, 21, 17, 15], [6, 7, 9, 10, 12, 15, 16, 16, 15, 13, 9, 8], 'IPMA, 1991–2020'),
  P('Berlin', 'Germany', [3, 5, 9, 15, 20, 23, 25, 25, 20, 14, 8, 4], [-2, -2, 0, 4, 8, 12, 14, 14, 10, 6, 2, -1], 'Deutscher Wetterdienst, 1991–2020'),
  P('Munich', 'Germany', [4, 6, 10, 15, 19, 23, 25, 25, 20, 15, 8, 5], [-2, -1, 2, 5, 9, 13, 15, 15, 10, 7, 2, -1], 'World Meteorological Organization, 1991–2020'),
  P('Frankfurt', 'Germany', [5, 7, 11, 17, 20, 24, 26, 26, 21, 15, 9, 6], [1, 0, 2, 5, 9, 13, 15, 14, 11, 7, 3, 0], 'Deutscher Wetterdienst, 1991–2020'),
  P('Hamburg', 'Germany', [4, 5, 9, 14, 18, 21, 23, 23, 19, 14, 8, 5], [-1, -1, 1, 4, 8, 11, 13, 13, 10, 6, 3, 0], 'World Meteorological Organization, 1991–2020'),
  P('Vienna', 'Austria', [4, 7, 11, 17, 21, 26, 27, 27, 22, 15, 10, 5], [0, 1, 4, 9, 12, 16, 18, 18, 14, 9, 5, 1], 'Central Institute for Meteorology and Geodynamics, 1991–2020'),
  P('Salzburg', 'Austria', [3, 6, 10, 16, 19, 23, 24, 24, 20, 14, 9, 4], [-4, -3, 1, 4, 8, 13, 14, 14, 10, 6, 1, -3], 'Central Institute for Meteorology and Geodynamics, 1991–2020'),
  P('Prague', 'Czechia', [4, 6, 10, 16, 21, 24, 27, 26, 20, 14, 9, 5], [-1, 0, 3, 7, 11, 15, 17, 16, 12, 8, 4, 1], 'Czech Hydrometeorological Institute, 1991–2020'),
  P('Budapest', 'Hungary', [5, 7, 12, 19, 23, 27, 29, 29, 23, 17, 11, 5], [-1, 0, 4, 9, 13, 16, 18, 18, 13, 9, 4, 0], 'NOAA NCEI, 1991–2020'),
  P('Warsaw', 'Poland', [1, 3, 7, 15, 20, 23, 25, 25, 19, 13, 7, 2], [-4, -3, -1, 4, 9, 12, 15, 14, 10, 5, 1, -3], 'Institute of Meteorology and Water Management, 1991–2020'),
  P('Krakow', 'Poland', [2, 4, 8, 15, 20, 23, 25, 25, 20, 14, 8, 3], [-5, -4, -1, 4, 9, 12, 14, 13, 9, 5, 1, -3], 'Institute of Meteorology and Water Management, 1991–2020'),
  P('Athens', 'Greece', [13, 14, 17, 21, 27, 32, 34, 34, 30, 24, 19, 14], [7, 7, 9, 12, 17, 22, 24, 24, 20, 16, 12, 9], 'National Observatory of Athens, 1991–2020'),
  P('Santorini', 'Greece', [14, 15, 16, 20, 23, 28, 30, 30, 27, 23, 19, 16], [10, 10, 11, 14, 17, 21, 23, 24, 21, 18, 15, 12], 'National Observatory of Athens, station averages 2013–2025'),
  P('Copenhagen', 'Denmark', [3, 3, 6, 11, 16, 19, 23, 21, 17, 12, 8, 5], [1, 1, 2, 4, 8, 12, 14, 14, 11, 7, 4, 2], 'Danish Meteorological Institute, 1991–2020'),
  P('Stockholm', 'Sweden', [1, 1, 5, 11, 17, 21, 24, 22, 17, 10, 5, 3], [-3, -3, -1, 3, 7, 12, 15, 14, 10, 6, 2, -1], 'SMHI, 1991–2020'),
  P('Oslo', 'Norway', [0, 1, 5, 11, 17, 20, 23, 21, 16, 10, 4, 1], [-5, -5, -2, 2, 7, 11, 13, 13, 9, 4, 0, -4], 'Norwegian Meteorological Institute, 1991–2020'),
  P('Helsinki', 'Finland', [-1, -1, 2, 8, 15, 19, 22, 21, 15, 9, 4, 1], [-6, -6, -4, 1, 6, 11, 15, 14, 9, 4, 0, -3], 'Finnish Meteorological Institute, 1991–2020'),
  P('Reykjavik', 'Iceland', [3, 3, 4, 7, 10, 13, 15, 14, 11, 8, 5, 3], [-2, -2, -1, 1, 4, 7, 9, 9, 6, 3, 0, -2], 'Icelandic Met Office, 1991–2020'),
  P('Moscow', 'Russia', [-4, -3, 3, 12, 19, 22, 25, 23, 16, 9, 2, -2], [-9, -9, -4, 2, 8, 12, 15, 13, 8, 3, -2, -7], 'Pogoda.ru.net, 1991–2020'),
  // Americas
  P('New York', 'United States', [4, 6, 10, 17, 22, 27, 29, 29, 25, 18, 12, 7], [-2, -1, 2, 8, 13, 18, 21, 21, 17, 11, 6, 1], 'NOAA, 1991–2020'),
  P('Los Angeles', 'United States', [20, 20, 21, 22, 23, 25, 28, 29, 28, 26, 23, 20], [9, 10, 11, 13, 15, 16, 18, 19, 18, 16, 12, 9], 'NOAA, 1991–2020'),
  P('San Francisco', 'United States', [14, 16, 17, 17, 18, 19, 19, 20, 21, 21, 18, 14], [8, 9, 9, 10, 11, 12, 12, 13, 13, 12, 10, 8], 'NOAA, 1991–2020'),
  P('Las Vegas', 'United States', [15, 17, 22, 26, 31, 37, 40, 39, 35, 27, 20, 14], [5, 7, 10, 14, 19, 24, 28, 27, 22, 15, 9, 4], 'NOAA, 1991–2020'),
  P('Chicago', 'United States', [0, 3, 9, 16, 22, 27, 30, 28, 25, 18, 10, 3], [-7, -5, 0, 5, 11, 17, 20, 19, 15, 8, 2, -4], 'NOAA, 1991–2020'),
  P('Washington, D.C.', 'United States', [7, 9, 14, 20, 25, 30, 32, 31, 27, 21, 15, 9], [-1, 0, 4, 9, 14, 20, 22, 22, 18, 11, 5, 1], 'NOAA, 1991–2020'),
  P('Boston', 'United States', [3, 4, 8, 14, 19, 25, 28, 27, 23, 17, 11, 6], [-5, -4, -1, 5, 10, 15, 19, 18, 15, 9, 3, -2], 'NOAA, 1991–2020'),
  P('Seattle', 'United States', [9, 10, 12, 15, 19, 22, 25, 25, 22, 16, 11, 8], [3, 3, 4, 6, 9, 12, 14, 14, 12, 8, 5, 3], 'NOAA, 1991–2020'),
  P('Orlando', 'United States', [22, 24, 26, 29, 31, 33, 33, 33, 32, 29, 26, 23], [10, 11, 13, 16, 19, 22, 23, 23, 22, 19, 15, 12], 'NOAA, 1991–2020'),
  P('Miami', 'United States', [25, 26, 27, 29, 30, 32, 33, 33, 32, 30, 27, 26], [16, 17, 19, 21, 23, 25, 25, 25, 25, 23, 20, 18], 'NOAA, 1991–2020'),
  P('Honolulu', 'United States', [27, 27, 27, 28, 29, 31, 31, 32, 31, 31, 29, 28], [19, 20, 20, 21, 22, 23, 24, 24, 24, 23, 22, 21], 'NOAA, 1991–2020'),
  P('Vancouver', 'Canada', [7, 8, 10, 13, 17, 20, 22, 22, 19, 14, 9, 7], [1, 2, 3, 6, 9, 12, 14, 14, 11, 7, 4, 1], 'Environment and Climate Change Canada, 1991–2020'),
  P('Toronto', 'Canada', [0, 1, 5, 12, 19, 24, 27, 26, 22, 15, 8, 3], [-7, -6, -2, 4, 10, 15, 18, 18, 14, 8, 2, -3], 'Environment and Climate Change Canada, 1991–2020'),
  P('Mexico City', 'Mexico', [22, 24, 26, 28, 27, 26, 25, 25, 24, 24, 23, 22], [9, 10, 11, 13, 14, 14, 13, 13, 13, 12, 10, 9], 'Servicio Meteorológico Nacional, 1991–2020'),
  P('Cancún', 'Mexico', [29, 29, 31, 32, 33, 34, 34, 34, 33, 32, 30, 29], [19, 20, 21, 22, 24, 25, 25, 25, 24, 23, 22, 20], 'Servicio Meteorológico Nacional, 1951–2010'),
  P('Rio de Janeiro', 'Brazil', [32, 32, 31, 30, 28, 27, 26, 27, 27, 28, 29, 30], [24, 24, 24, 23, 21, 19, 19, 19, 20, 21, 22, 23], 'Instituto Nacional de Meteorologia, 1981–2010'),
  P('Buenos Aires', 'Argentina', [30, 29, 27, 23, 19, 16, 16, 18, 20, 23, 26, 29], [20, 19, 18, 14, 11, 8, 8, 9, 11, 13, 16, 19], 'Servicio Meteorológico Nacional, 1991–2020'),
  // Australia and New Zealand
  P('Sydney', 'Australia', [27, 27, 26, 24, 21, 18, 18, 19, 22, 23, 24, 26], [20, 20, 18, 15, 12, 10, 9, 10, 12, 15, 17, 18], 'Bureau of Meteorology, 1991–2020'),
  P('Melbourne', 'Australia', [27, 27, 25, 21, 18, 15, 14, 15, 18, 20, 22, 24], [16, 16, 14, 12, 10, 8, 7, 8, 9, 10, 12, 14], 'Bureau of Meteorology, 1991–2020'),
  P('Perth', 'Australia', [31, 32, 30, 26, 22, 20, 19, 19, 21, 24, 27, 30], [18, 18, 17, 14, 11, 9, 8, 9, 10, 12, 14, 17], 'Bureau of Meteorology'),
  P('Brisbane', 'Australia', [30, 30, 29, 27, 25, 22, 22, 24, 26, 27, 28, 30], [22, 22, 20, 17, 14, 12, 11, 11, 14, 17, 19, 21], 'Bureau of Meteorology, 1999–2024'),
  P('Gold Coast', 'Australia', [29, 29, 28, 26, 24, 21, 21, 22, 24, 25, 27, 28], [22, 22, 21, 18, 15, 13, 12, 13, 15, 17, 19, 21], 'Bureau of Meteorology, 1992–2020'),
  P('Cairns', 'Australia', [32, 32, 31, 30, 28, 27, 26, 27, 29, 30, 31, 32], [24, 24, 23, 22, 20, 19, 17, 17, 19, 21, 23, 24], 'Bureau of Meteorology, 1991–2020'),
  P('Auckland', 'New Zealand', [24, 24, 23, 20, 18, 16, 15, 15, 17, 18, 20, 22], [16, 17, 15, 13, 11, 9, 8, 8, 10, 11, 13, 15], 'NIWA, 1991–2020'),
  P('Queenstown', 'New Zealand', [22, 22, 19, 15, 12, 9, 8, 10, 13, 15, 18, 20], [10, 10, 7, 5, 2, 0, -1, 0, 2, 4, 6, 9], 'NIWA, 1991–2020'),
  P('Christchurch', 'New Zealand', [23, 22, 20, 17, 15, 12, 11, 13, 15, 17, 19, 21], [12, 12, 10, 7, 4, 1, 1, 2, 4, 6, 8, 10], 'NIWA, 1991–2020'),
  P('Wellington', 'New Zealand', [20, 21, 19, 17, 15, 12, 12, 12, 14, 15, 17, 19], [14, 14, 13, 11, 9, 7, 7, 7, 8, 9, 10, 12], 'NIWA, 1991–2020'),
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

export type ClimateGuess = { climate: Climate; low: number; high: number; places: string[]; months: string; sources: string };

/**
 * What the weather is likely to be, from the listed places and the months the trip touches: cold
 * when days usually reach 14°C or less, warm from 24°C, some of each between (or when one place is
 * much warmer than another). Null without dates or a listed place. `sources` says where each
 * place's figures come from.
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
  const sources = `Usual daily highs and lows, not a forecast. ${found.map((item) => `${item.name}: ${item.source}`).join('; ')}.`;
  return { climate, low, high, places: found.map((item) => item.name), months: label, sources };
}

/** "usually 9–17°C in Nov", to follow other words or open a line with its first letter raised. */
export const guessText = (guess: ClimateGuess) => `usually ${guess.low}–${guess.high}°C in ${guess.months}`;
