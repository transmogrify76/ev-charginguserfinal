// src/components/SessionReceiptPDF.tsx
//
// Shared charging-session receipt PDF, used by both TransactionHistory.tsx
// (drill-down from a wallet ledger entry) and SessionHistory.tsx (drill-down
// from a session card directly). Extracted rather than duplicated so the two
// screens can never drift out of sync on what a receipt actually shows.

import React from 'react';
import { pdf, Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer';
import { ChargingSessionResponse } from '../types/auth';

const pdfStyles = StyleSheet.create({
  page: { padding: 28, fontSize: 9, fontFamily: 'Helvetica', backgroundColor: '#ffffff' },
  header: {
    backgroundColor: '#4f7a1f',
    padding: 14,
    marginBottom: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  companyName: { fontSize: 18, fontWeight: 'bold', color: '#ffffff' },
  companyTagline: { fontSize: 8, color: '#e4efd8' },
  headerRight: { alignItems: 'flex-end' },
  receiptTitle: { fontSize: 12, fontWeight: 'bold', color: '#ffffff' },
  sectionTitle: {
    fontSize: 10,
    fontWeight: 'bold',
    marginTop: 10,
    marginBottom: 5,
    backgroundColor: '#f1f5e9',
    color: '#3c5b17',
    padding: 4,
    paddingLeft: 7,
  },
  row: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: '#eeeeee', paddingVertical: 3 },
  label: { width: '38%', fontWeight: 'bold', color: '#555555' },
  value: { width: '62%' },
  amountRow: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: '#dddddd', paddingVertical: 3 },
  amountLabel: { width: '50%', fontWeight: 'bold' },
  amountValue: { width: '50%', textAlign: 'right' },
  totalRow: { flexDirection: 'row', paddingVertical: 5, marginTop: 2 },
  totalLabel: { width: '50%', fontWeight: 'bold', fontSize: 11 },
  totalValue: { width: '50%', textAlign: 'right', fontWeight: 'bold', fontSize: 11, color: '#4f7a1f' },
  footer: {
    marginTop: 20,
    fontSize: 7,
    color: '#888888',
    textAlign: 'center',
    borderTopWidth: 0.5,
    borderTopColor: '#cccccc',
    paddingTop: 8,
  },
});

export const dash = (v?: string | number | null) => (v === undefined || v === null || v === '' ? '—' : String(v));

/**
 * Cosmetic-only formatting of a raw backend code, never a translation or
 * interpretation. Per handoff v14, stop-reason codes must be shown as-is,
 * not turned into inferred prose without product-owned presentation rules.
 */
const formatRawCode = (v?: string | null) => (v ? v.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : undefined);
export const fmtDT = (v?: string) => {
  if (!v) return '—';
  const d = new Date(v);
  return isNaN(d.getTime()) ? v : new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(d);
};

const LIMIT_TYPE_LABEL: Record<string, string> = { ENERGY: 'Energy', TIME: 'Time', MONEY: 'Amount' };

const SessionReceiptPDF: React.FC<{ session: ChargingSessionResponse }> = ({ session }) => (
  <Document>
    <Page size="A4" style={pdfStyles.page}>
      <View style={pdfStyles.header}>
        <View>
          <Text style={pdfStyles.companyName}>TransEV</Text>
          <Text style={pdfStyles.companyTagline}>Electric Vehicle Charging Network</Text>
        </View>
        <View style={pdfStyles.headerRight}>
          <Text style={pdfStyles.receiptTitle}>CHARGING RECEIPT</Text>
          <Text style={{ fontSize: 8, color: '#ffffff' }}>Session {session.id.slice(0, 8)}</Text>
        </View>
      </View>

      <Text style={pdfStyles.sectionTitle}>CHARGER</Text>
      <View>
        <View style={pdfStyles.row}>
          <Text style={pdfStyles.label}>Charger</Text>
          <Text style={pdfStyles.value}>{dash(session.charger?.name || session.charger?.charger_id)}</Text>
        </View>
        <View style={pdfStyles.row}>
          <Text style={pdfStyles.label}>Location</Text>
          <Text style={pdfStyles.value}>{dash(session.charger?.hub?.name)} {session.charger?.hub?.address ? `· ${session.charger.hub.address}` : ''}</Text>
        </View>
        <View style={pdfStyles.row}>
          <Text style={pdfStyles.label}>Connector</Text>
          <Text style={pdfStyles.value}>{dash(session.connector?.type)}{session.connector?.number ? ` · #${session.connector.number}` : ''}</Text>
        </View>
      </View>

      <Text style={pdfStyles.sectionTitle}>SESSION</Text>
      <View>
        <View style={pdfStyles.row}>
          <Text style={pdfStyles.label}>Started</Text>
          <Text style={pdfStyles.value}>{fmtDT(session.started_at)}</Text>
        </View>
        <View style={pdfStyles.row}>
          <Text style={pdfStyles.label}>Completed</Text>
          <Text style={pdfStyles.value}>{fmtDT(session.completed_at)}</Text>
        </View>
        <View style={pdfStyles.row}>
          <Text style={pdfStyles.label}>Energy Consumed</Text>
          <Text style={pdfStyles.value}>{session.total_kwh ? `${session.total_kwh} kWh` : '—'}</Text>
        </View>
        {session.limit && (session.limit.energy_limit_wh > 0 || session.limit.max_duration_seconds > 0) && (
          <View style={pdfStyles.row}>
            <Text style={pdfStyles.label}>Charge Limit</Text>
            <Text style={pdfStyles.value}>
              {LIMIT_TYPE_LABEL[session.limit.type] || session.limit.type}
              {session.limit.requested_value && session.limit.requested_unit
                ? ` \u2013 requested ${session.limit.requested_value} ${session.limit.requested_unit}`
                : ''}
              {session.limit.energy_limit_wh > 0 ? ` \u00b7 up to ${(session.limit.energy_limit_wh / 1000).toFixed(2)} kWh` : ''}
              {session.limit.max_duration_seconds > 0 ? ` \u00b7 up to ${Math.round(session.limit.max_duration_seconds / 60)} min` : ''}
            </Text>
          </View>
        )}
      </View>

      {session.pricing && (
        <>
          <Text style={pdfStyles.sectionTitle}>PRICING</Text>
          <View>
            <View style={pdfStyles.row}>
              <Text style={pdfStyles.label}>Rate</Text>
              <Text style={pdfStyles.value}>
                {session.pricing.price_per_unit ? `\u20b9${session.pricing.price_per_unit} / ${session.pricing.units || session.pricing.price_type || ''}` : '—'}
              </Text>
            </View>
            {session.tax && (
              <View style={pdfStyles.row}>
                <Text style={pdfStyles.label}>Tax</Text>
                <Text style={pdfStyles.value}>
                  {[
                    session.tax.sgst_rate ? `SGST ${session.tax.sgst_rate}%` : null,
                    session.tax.cgst_rate ? `CGST ${session.tax.cgst_rate}%` : null,
                    session.tax.igst_rate ? `IGST ${session.tax.igst_rate}%` : null,
                  ]
                    .filter(Boolean)
                    .join(' \u00b7 ') || '—'}
                </Text>
              </View>
            )}
          </View>
        </>
      )}

      <Text style={pdfStyles.sectionTitle}>PAYMENT</Text>
      <View>
        <View style={pdfStyles.amountRow}>
          <Text style={pdfStyles.amountLabel}>Payment method</Text>
          <Text style={pdfStyles.amountValue}>{dash(session.financial?.payment_method || 'Wallet')}</Text>
        </View>
        <View style={pdfStyles.amountRow}>
          <Text style={pdfStyles.amountLabel}>Payment status</Text>
          <Text style={pdfStyles.amountValue}>{dash(session.financial?.payment_status || session.settlement_status)}</Text>
        </View>
        <View style={pdfStyles.totalRow}>
          <Text style={pdfStyles.totalLabel}>Total Amount</Text>
          <Text style={pdfStyles.totalValue}>
            {session.total_amount ? `${session.currency || 'INR'} ${session.total_amount}` : '—'}
          </Text>
        </View>
      </View>

      {(session.stop?.requested_initiator || session.stop?.requested_reason || session.stop?.ocpp_reason || session.stop_reason) && (
        <>
          <Text style={pdfStyles.sectionTitle}>STOP DETAILS</Text>
          <View>
            {session.stop?.requested_initiator && (
              <View style={pdfStyles.amountRow}>
                <Text style={pdfStyles.amountLabel}>Requested by</Text>
                <Text style={pdfStyles.amountValue}>{formatRawCode(session.stop.requested_initiator)}</Text>
              </View>
            )}
            {(session.stop?.requested_reason || session.stop_reason) && (
              <View style={pdfStyles.amountRow}>
                <Text style={pdfStyles.amountLabel}>Reason</Text>
                <Text style={pdfStyles.amountValue}>{formatRawCode(session.stop?.requested_reason || session.stop_reason)}</Text>
              </View>
            )}
            {session.stop?.ocpp_reason && (
              <View style={pdfStyles.amountRow}>
                <Text style={pdfStyles.amountLabel}>OCPP reason</Text>
                <Text style={pdfStyles.amountValue}>{session.stop.ocpp_reason}</Text>
              </View>
            )}
          </View>
        </>
      )}

      <Text style={pdfStyles.footer}>
        This receipt was generated electronically from your TransEV account.{'\n'}
        Session {session.id} · Generated on {new Date().toLocaleDateString('en-IN', { dateStyle: 'medium' })}
      </Text>
    </Page>
  </Document>
);

export async function downloadSessionReceiptPDF(session: ChargingSessionResponse): Promise<void> {
  const blob = await pdf(<SessionReceiptPDF session={session} />).toBlob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `receipt_${session.id.slice(0, 8)}.pdf`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export default SessionReceiptPDF;
