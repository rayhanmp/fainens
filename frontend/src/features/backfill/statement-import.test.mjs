import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  findExistingMatches, guessMapping, matchByName, pairTransfers, parseCsv, parseStatementAmount, parseStatementDate, parseStatementRows,
  parseStatementTime, statementReference,
} from './statement-import.ts';

const day = (y, m, d) => new Date(y, m - 1, d).getTime();

test('parseCsv picks the delimiter that keeps columns consistent and honours quotes', () => {
  const semi = parseCsv('Tanggal;Keterangan;Debet;Kredit\n01/03/2026;"Indomaret, Kalibata";25.000,00;\n25/03/2026;Gaji;;7.554.552,00\n');
  assert.equal(semi.delimiter, ';');
  assert.deepEqual(semi.headers, ['Tanggal', 'Keterangan', 'Debet', 'Kredit']);
  assert.deepEqual(semi.rows[0], ['01/03/2026', 'Indomaret, Kalibata', '25.000,00', '']);
  const comma = parseCsv('﻿Date,Description,Amount\n2026-03-01,"Say ""hi""",-10000\n');
  assert.equal(comma.delimiter, ',');
  assert.deepEqual(comma.rows[0], ['2026-03-01', 'Say "hi"', '-10000']);
});

test('guessMapping reads Indonesian and English headers into split or signed mode', () => {
  const split = guessMapping(['Tanggal Transaksi', 'Uraian Transaksi', 'Debet', 'Kredit', 'Saldo']);
  assert.deepEqual([split.date, split.description, split.debit, split.credit, split.amountMode], [0, 1, 2, 3, 'split']);
  const signed = guessMapping(['Date', 'Description', 'Amount', 'Balance']);
  assert.deepEqual([signed.date, signed.description, signed.amount, signed.amountMode], [0, 1, 2, 'signed']);
});

test('a hand-kept list maps account, destination and category columns and reads them per row', () => {
  const headers = ['Date', 'Account', 'To account', 'Description', 'Category', 'Amount'];
  const mapping = guessMapping(headers);
  assert.deepEqual([mapping.account, mapping.toAccount, mapping.category, mapping.amount], [1, 2, 4, 5]);
  const [row] = parseStatementRows([['2026-03-03', 'BNI', 'GoPay', 'Top up', '', '-200000']], { ...mapping, dateFormat: 'YYYY-MM-DD' });
  assert.deepEqual([row.accountText, row.toAccountText, row.categoryText, row.amount], ['BNI', 'GoPay', '', -200_000]);
  const indonesian = guessMapping(['Tanggal', 'Akun', 'Ke akun', 'Keterangan', 'Kategori', 'Nominal']);
  assert.deepEqual([indonesian.account, indonesian.toAccount, indonesian.category], [1, 2, 4]);
});

test('a type column signs all-positive amounts and flags words it does not know', () => {
  const mapping = guessMapping(['Tanggal', 'Akun', 'Jenis', 'Keterangan', 'Nominal']);
  assert.equal(mapping.type, 2);
  const rows = parseStatementRows([
    ['01/03/2026', 'BNI', 'Pengeluaran', 'Makan', '25.000'],
    ['25/03/2026', 'BNI', 'income', 'Gaji', '7.554.552'],
    ['26/03/2026', 'BNI', 'CR', 'Refund', '-10.000'],
    ['27/03/2026', 'BNI', 'hmm', 'Huh', '5.000'],
  ], mapping);
  assert.deepEqual(rows.map((row) => row.amount), [-25_000, 7_554_552, 10_000, 5_000]);
  assert.deepEqual(rows[3].errors, ['Unknown type "hmm"']);
});

test('matchByName ignores case, spacing and punctuation', () => {
  const accounts = [{ id: 1, name: 'BNI' }, { id: 2, name: 'Go-Pay' }];
  assert.equal(matchByName(accounts, ' bni ')?.id, 1);
  assert.equal(matchByName(accounts, 'gopay')?.id, 2);
  assert.equal(matchByName(accounts, 'OVO'), undefined);
  assert.equal(matchByName(accounts, ''), undefined);
});

test('statement dates parse in every supported format and reject impossible days', () => {
  assert.equal(parseStatementDate('10/03/2026', 'DD/MM/YYYY'), day(2026, 3, 10));
  assert.equal(parseStatementDate('03/10/2026', 'MM/DD/YYYY'), day(2026, 3, 10));
  assert.equal(parseStatementDate('2026-03-10', 'YYYY-MM-DD'), day(2026, 3, 10));
  assert.equal(parseStatementDate('10 Mar 2026', 'DD MMM YYYY'), day(2026, 3, 10));
  assert.equal(parseStatementDate('10-Agu-26', 'DD MMM YYYY'), day(2026, 8, 10));
  assert.equal(parseStatementDate('31/02/2026', 'DD/MM/YYYY'), null);
  assert.equal(parseStatementDate('', 'DD/MM/YYYY'), null);
});

test('a time in the date cell or in its own column is kept, and a bad one is flagged', () => {
  const at = (y, m, d, h, mi, s = 0) => new Date(y, m - 1, d, h, mi, s).getTime();
  assert.equal(parseStatementDate('10/03/2026 14:22', 'DD/MM/YYYY'), at(2026, 3, 10, 14, 22));
  assert.equal(parseStatementDate('10/03/2026 14.22.05', 'DD/MM/YYYY'), at(2026, 3, 10, 14, 22, 5));
  assert.equal(parseStatementDate('2026-03-10T14:22:01.000Z', 'YYYY-MM-DD'), at(2026, 3, 10, 14, 22, 1));
  assert.equal(parseStatementDate('10 Mar 2026 2:05 PM', 'DD MMM YYYY'), at(2026, 3, 10, 14, 5));
  assert.equal(parseStatementDate('10/03/2026 25:00', 'DD/MM/YYYY'), null);
  assert.deepEqual(parseStatementTime('07:30 WIB'), [7, 30, 0]);
  assert.equal(parseStatementTime('12:00 AM')[0], 0);
  assert.equal(parseStatementTime('lunch'), null);

  const mapping = guessMapping(['Tanggal', 'Jam', 'Akun', 'Keterangan', 'Nominal']);
  assert.deepEqual([mapping.date, mapping.time], [0, 1]);
  const rows = parseStatementRows([
    ['10/03/2026', '08:15', 'BNI', 'Kopi', '-25000'],
    ['10/03/2026', '', 'BNI', 'No time', '-1000'],
    ['10/03/2026', 'pagi', 'BNI', 'Bad time', '-1000'],
  ], mapping);
  assert.equal(rows[0].dateMs, at(2026, 3, 10, 8, 15));
  assert.equal(rows[1].dateMs, day(2026, 3, 10));
  assert.deepEqual(rows[2].errors, ['Unreadable time "pagi"']);
  assert.equal(statementReference(1, at(2026, 3, 10, 6, 0), -25_000, 'Kopi').split(':').slice(0, 3).join(':'), 'stmt:1:2026-03-10T0600');
});

test('statement amounts parse Indonesian and English groupings, parentheses and DB/CR marks', () => {
  assert.equal(parseStatementAmount('1.234.567,00'), 1_234_567);
  assert.equal(parseStatementAmount('1,234,567.00'), 1_234_567);
  assert.equal(parseStatementAmount('25.000'), 25_000);
  assert.equal(parseStatementAmount('(1.234)'), -1_234);
  assert.equal(parseStatementAmount('-1234'), -1_234);
  assert.equal(parseStatementAmount('Rp 7.554.552'), 7_554_552);
  assert.equal(parseStatementAmount('50.000,00 DB'), -50_000);
  assert.equal(parseStatementAmount('50.000,00 CR'), 50_000);
  assert.equal(parseStatementAmount(''), null);
  assert.equal(parseStatementAmount('n/a'), null);
});

test('parseStatementRows signs split columns as money out negative, money in positive, and keeps errors', () => {
  const mapping = guessMapping(['Tanggal', 'Keterangan', 'Debet', 'Kredit']);
  const rows = parseStatementRows([
    ['01/03/2026', 'Indomaret', '25.000,00', ''],
    ['25/03/2026', 'Gaji', '', '7.554.552,00'],
    ['xx/03/2026', '', '', ''],
  ], mapping);
  assert.deepEqual(rows[0], { rowNumber: 2, dateMs: day(2026, 3, 1), description: 'Indomaret', amount: -25_000, accountText: '', toAccountText: '', categoryText: '', errors: [] });
  assert.equal(rows[1].amount, 7_554_552);
  assert.deepEqual(rows[2].errors, ['Unreadable date "xx/03/2026"', 'No description', 'Amount is zero']);
});

test('existing matches pair each ledger row with at most one statement row within a day', () => {
  const rows = [
    { key: 'a', dateMs: day(2026, 3, 1), amount: -25_000 },
    { key: 'b', dateMs: day(2026, 3, 1), amount: -25_000 },
    { key: 'c', dateMs: day(2026, 3, 5), amount: -25_000 },
  ];
  const existing = [{ id: 9, dateMs: day(2026, 3, 2), amount: -25_000, description: 'Indomaret' }];
  const matches = findExistingMatches(rows, existing);
  assert.deepEqual([...matches.keys()], ['a']);
  assert.equal(matches.get('a').id, 9);
});

test('transfers pair a debit with an equal credit on another account, nearest date first, once each', () => {
  const rows = [
    { key: 'bni-out', accountId: 1, dateMs: day(2026, 3, 3), amount: -200_000 },
    { key: 'gopay-in', accountId: 2, dateMs: day(2026, 3, 3), amount: 200_000 },
    { key: 'gopay-in-later', accountId: 2, dateMs: day(2026, 3, 9), amount: 200_000 },
    { key: 'bni-in-same-account', accountId: 1, dateMs: day(2026, 3, 3), amount: 200_000 },
    { key: 'coffee', accountId: 2, dateMs: day(2026, 3, 3), amount: -25_000 },
  ];
  assert.deepEqual(pairTransfers(rows), [{ outKey: 'bni-out', inKey: 'gopay-in' }]);
});
