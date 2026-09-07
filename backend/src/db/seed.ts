import { categories, salarySettings } from "./schema";
import { eq } from "drizzle-orm";

export const TRANSFER_FEE_CATEGORY_NAME = "Bank & Transfer Fees";

const DEFAULT_CATEGORIES: Array<{ name: string; icon: string; color: string }> = [
  { name: "Food & Dining", icon: "🍽️", color: "#F59E0B" },
  { name: "Transportation", icon: "🚗", color: "#3B82F6" },
  { name: "Housing & Rent", icon: "🏠", color: "#8B5CF6" },
  { name: "Utilities", icon: "💡", color: "#EAB308" },
  { name: "Healthcare", icon: "🏥", color: "#EC4899" },
  { name: "Entertainment", icon: "🎬", color: "#10B981" },
  { name: "Shopping", icon: "🛍️", color: "#F97316" },
  { name: "Education", icon: "📚", color: "#6366F1" },
  { name: "Savings", icon: "💰", color: "#14B8A6" },
  { name: "Others", icon: "📌", color: "#64748B" },
  { name: TRANSFER_FEE_CATEGORY_NAME, icon: "🏦", color: "#0EA5E9" },
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
