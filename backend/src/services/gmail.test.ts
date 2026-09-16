import { describe, expect, it } from "vitest";
import {
  decryptGmailRefreshToken,
  encryptGmailRefreshToken,
  parseWondrBniEmail,
} from "./gmail";

function encoded(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

const sampleHtml = `
  <table class="account-details">
    <tr><td class="account-title"><b>Recipient</b></td></tr>
    <tr><td>SOGOGI RESERVE</td></tr>
    <tr><td>JAKARTA SELATAN</td></tr>
  </table>
  <table class="account-details">
    <tr><td class="account-title"><b>Source of funds</b></td></tr>
    <tr><td>TAPLUS MUDA</td></tr>
    <tr><td>*******897</td></tr>
  </table>
  <table>
    <tr><td>Amount</td><td>Rp654.500</td></tr>
    <tr><td>Date</td><td>12 Sep 2026</td></tr>
    <tr><td>Time</td><td>18:41:20 WIB</td></tr>
    <tr><td>Transaction type</td><td>QRIS</td></tr>
    <tr><td>Reference ID</td><td>20260912184116000111</td></tr>
    <tr><td>RRN code</td><td>6c1303baed88</td></tr>
  </table>`;

describe("wondr BNI email parser", () => {
  it("extracts a QRIS expense without sending the HTML to an LLM", () => {
    const result = parseWondrBniEmail({
      id: "gmail-message-1",
      payload: {
        headers: [
          { name: "From", value: "wondr@bni.co.id" },
          { name: "Subject", value: "Transaction successful!" },
        ],
        mimeType: "text/html",
        body: { data: encoded(sampleHtml) },
      },
    });

    expect(result?.messageId).toBe("gmail-message-1");
    expect(result?.parsed).toMatchObject({
      type: "expense",
      amount: 654500,
      description: "SOGOGI RESERVE",
      category: "Food & Dining",
      date: "2026-09-12",
      place: "JAKARTA SELATAN",
      fromAccount: "TAPLUS MUDA • *******897",
      reference: "20260912184116000111",
      transactionType: "QRIS",
    });
  });

  it("ignores messages that are not BNI successful-transaction notifications", () => {
    const result = parseWondrBniEmail({
      id: "gmail-message-2",
      payload: {
        headers: [
          { name: "From", value: "someone@example.com" },
          { name: "Subject", value: "Hello" },
        ],
        mimeType: "text/html",
        body: { data: encoded(sampleHtml) },
      },
    });
    expect(result).toBeNull();
  });

  it("round-trips the encrypted refresh token", () => {
    const token = "refresh-token-used-only-by-the-server";
    expect(decryptGmailRefreshToken(encryptGmailRefreshToken(token))).toBe(token);
  });
});
