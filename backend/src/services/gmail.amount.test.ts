import { describe, expect, it } from "vitest";
import { parseRupiah, parseWondrBniEmail } from "./gmail";

function encoded(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

const html = (amount: string) => `
  <table class="account-details">
    <tr><td class="account-title"><b>Recipient</b></td></tr>
    <tr><td>SOGOGI RESERVE</td></tr>
  </table>
  <table>
    <tr><td>Amount</td><td>${amount}</td></tr>
    <tr><td>Date</td><td>12 Sep 2026</td></tr>
  </table>`;

describe("wondr BNI notification amounts", () => {
  it.each([
    ["Rp654.500", 654_500],
    ["Rp654.500,00", 654_500],
    ["IDR 654,500.00", 654_500],
    ["Rp 1.234.567", 1_234_567],
    ["Rp10.000,50", null],
    ["Rp0", null],
    ["-", null],
  ])("parses %s", (input, expected) => {
    expect(parseRupiah(input)).toBe(expected);
  });

  it("does not multiply a decimal amount by 100", () => {
    const result = parseWondrBniEmail({
      id: "gmail-message-decimal",
      payload: {
        headers: [
          { name: "From", value: "wondr <wondr@bni.co.id>" },
          { name: "Subject", value: "Transaction successful!" },
        ],
        mimeType: "text/html",
        body: { data: encoded(html("Rp654.500,00")) },
      },
    });
    expect(result?.parsed.amount).toBe(654_500);
  });
});
