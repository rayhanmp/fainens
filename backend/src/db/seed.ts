import { categories, salarySettings } from "./schema";
import { eq } from "drizzle-orm";

export const TRANSFER_FEE_CATEGORY_NAME = "Bank & Transfer Fees";

const DEFAULT_CATEGORIES: Array<{ name: string; icon: string; color: string }> = [
  { name: "Food & Dining", icon: "🍽️", color: "#F2A541" },
  { name: "Transportation", icon: "🚗", color: "#2878B5" },
  { name: "Housing & Rent", icon: "🏠", color: "#7950A1" },
  { name: "Utilities", icon: "💡", color: "#B08900" },
  { name: "Healthcare", icon: "🏥", color: "#D45087" },
  { name: "Entertainment", icon: "🎬", color: "#3A9D5D" },
  { name: "Shopping", icon: "🛍️", color: "#E4572E" },
  { name: "Education", icon: "📚", color: "#9C6644" },
  { name: "Savings", icon: "💰", color: "#008C70" },
  { name: "Others", icon: "📌", color: "#6C757D" },
  { name: TRANSFER_FEE_CATEGORY_NAME, icon: "🏦", color: "#A44A9C" },
];

export async function seedDb(db: any) {
  const existing = await db.select({ id: categories.id }).from(categories).limit(1);

  if (existing.length === 0) {
    for (const row of DEFAULT_CATEGORIES) {
      await db.insert(categories).values(row);
    }
  } else {
    const [transferFeeCategory] = await db
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.name, TRANSFER_FEE_CATEGORY_NAME))
      .limit(1);
    if (!transferFeeCategory) {
      await db.insert(categories).values({
        name: TRANSFER_FEE_CATEGORY_NAME,
        icon: "🏦",
        color: "#0EA5E9",
      });
    }
  }

  const salaryRow = await db.select({ id: salarySettings.id }).from(salarySettings).limit(1);
  if (salaryRow.length === 0) {
    await db.insert(salarySettings).values({
      id: 1,
      grossMonthly: 0,
      payrollDay: 25,
      ptkpCode: "TK0",
    });
  }
}
