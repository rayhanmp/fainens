import {
  Baby, Banknote, Briefcase, Bus, Car, Clapperboard, Coffee, CreditCard, Dumbbell, Fuel, Gamepad2, Gift, GraduationCap,
  HeartPulse, Home, Landmark, Laptop, Music, Palette, PawPrint, Plane, Receipt, Repeat, Shapes, ShieldCheck, Shirt, ShoppingBag,
  ShoppingCart, Smartphone, Sparkles, Tag, TrendingUp, Utensils, Wifi, Wrench, Zap, type LucideIcon,
} from 'lucide-react';

/** Keyword → icon, first match wins; English and Indonesian names are both covered. */
const rules: [RegExp, LucideIcon][] = [
  [/coffee|cafe|kopi/i, Coffee],
  [/grocer|supermarket|pasar|bulanan/i, ShoppingCart],
  [/food|dining|restaurant|makan|meal|snack|jajan/i, Utensils],
  [/\bbus\b|train|kereta|krl|mrt|commute/i, Bus],
  [/fuel|bensin|petrol|gas\b/i, Fuel],
  [/transport|ride|ojek|taxi|grab|gojek|parking|parkir|toll|tol\b/i, Car],
  [/internet|wifi|data\b/i, Wifi],
  [/phone|pulsa|mobile|hp\b/i, Smartphone],
  [/utilit|electric|listrik|water|air\b|pln|pdam|bill|tagihan/i, Zap],
  [/health|medic|doctor|pharma|obat|hospital|dokter|clinic/i, HeartPulse],
  [/insurance|asuransi|bpjs/i, ShieldCheck],
  [/game|gaming|steam/i, Gamepad2],
  [/tech|gadget|electronic|computer|laptop|software/i, Laptop],
  [/hobb|craft|\bart\b|photo/i, Palette],
  [/music|spotify|concert|konser/i, Music],
  [/entertain|movie|cinema|film|bioskop|streaming|netflix|hiburan/i, Clapperboard],
  [/fashion|cloth|apparel|shoe|baju|sepatu|outfit/i, Shirt],
  [/beauty|salon|skincare|groom|kecantikan|barber/i, Sparkles],
  [/rent|house|home|kos\b|kost|mortgage|sewa|rumah|furniture/i, Home],
  [/repair|maintenance|service|servis|bengkel/i, Wrench],
  [/educat|school|course|book|kuliah|tuition|sekolah|buku|kursus/i, GraduationCap],
  [/travel|trip|holiday|flight|hotel|vacation|liburan|wisata/i, Plane],
  [/gift|donat|charity|zakat|sedekah|hadiah|kado/i, Gift],
  [/subscri|member|langganan/i, Repeat],
  [/gym|fitness|sport|olahraga|workout/i, Dumbbell],
  [/\bpet|cat\b|dog\b|kucing|anjing/i, PawPrint],
  [/baby|kid|child|anak|toddler/i, Baby],
  [/salary|gaji|income|payroll|bonus|wage/i, Banknote],
  [/invest|saving|tabung|stock|saham|crypto|reksa/i, TrendingUp],
  [/loan|debt|cicilan|paylater|installment|hutang|utang/i, CreditCard],
  [/\bfee|bank|transfer|admin/i, Landmark],
  [/tax|pajak/i, Receipt],
  [/work|business|office|usaha|kantor/i, Briefcase],
  [/shop|belanja|store|mall|online/i, ShoppingBag],
  [/other|lain|misc|general|umum/i, Shapes],
];

/** A line icon for a category, chosen from its name. */
export function categoryIcon(name: string): LucideIcon {
  return rules.find(([pattern]) => pattern.test(name))?.[1] ?? Tag;
}
