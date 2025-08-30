'use client';

import React from 'react';

type QuoteItem = {
  ref?: string;
  label?: string;
  qty?: number;
  unitPrice?: number;
  subtotal?: number;
};

type QuoteTotals = {
  net?: number;
  tax?: number;
  fees?: number;
  discount?: number;
  grandTotal?: number;
};

type QuoteValidity = {
  until?: string;   // ISO o libre
  notes?: string;   // condiciones comerciales / aclaraciones
};

export type QuoteData = {
  currency?: string;            // ej. "USD", "MXN", "COP", "EUR"
  items?: QuoteItem[];
  totals?: QuoteTotals;
  validity?: QuoteValidity;
  customer?: { name?: string; email?: string };
  meta?: { quoteId?: string; createdAt?: string };
};

function getLocaleFromCurrency(ccy?: string) {
  const code = (ccy || '').toUpperCase();
  if (code === 'MXN') return 'es-MX';
  if (code === 'COP') return 'es-CO';
  if (code === 'EUR') return 'es-ES';
  if (code === 'USD') return 'en-US';
  return 'es-MX';
}
function fmtMoney(n?: number, ccy?: string) {
  if (typeof n !== 'number' || Number.isNaN(n)) return '';
  return new Intl.NumberFormat(getLocaleFromCurrency(ccy), { style: 'currency', currency: (ccy || 'USD').toUpperCase() }).format(n);
}
function safe(x?: string | number) {
  if (x === undefined || x === null) return '';
  if (typeof x === 'string') return x.trim();
  return String(x);
}

export default function QuoteCard({ data }: { data: QuoteData }) {
  const ccy = (data?.currency || 'USD').toUpperCase();
  const items = (data?.items || []).filter(it => (it?.label || '').trim() !== '');
  const totals = data?.totals || {};
  const validity = data?.validity || {};
  const hasFees = typeof totals.fees === 'number' && totals.fees !== 0;
  const hasTax  = typeof totals.tax  === 'number' && totals.tax  !== 0;
  const hasDisc = typeof totals.discount === 'number' && totals.discount !== 0;

  return (
    <div className="cv-quote">
      {/* Banda superior con diagonales + logo */}
      <div className="topband">
        <div className="brand">
          <picture>
            <source srcSet="/images/coco-volare-logo.svg" type="image/svg+xml" />
            <img src="/images/coco-volare-logo.png" alt="Coco Volare" className="logo" />
          </picture>
          <div className="title">
            <div className="k">COTIZACIÓN</div>
            {data?.meta?.quoteId && <div className="sub">Folio: {safe(data.meta.quoteId)}</div>}
          </div>
        </div>
        <div className="ccy">{ccy}</div>
      </div>

      {/* División perforada (pase de abordar vibes) */}
      <div className="perforation" aria-hidden="true">
        <div className="dots" />
      </div>

      {/* Detalle de conceptos */}
      {items.length > 0 && (
        <div className="items">
          {items.map((it, idx) => {
            const haveRight = typeof it.subtotal === 'number' || typeof it.unitPrice === 'number';
            const qty = typeof it.qty === 'number' && it.qty > 0 ? it.qty : undefined;
            const unit = typeof it.unitPrice === 'number' ? fmtMoney(it.unitPrice, ccy) : '';
            const sub  = typeof it.subtotal  === 'number' ? fmtMoney(it.subtotal,  ccy) : (typeof it.qty === 'number' && typeof it.unitPrice === 'number' ? fmtMoney(it.qty * it.unitPrice, ccy) : '');
            return (
              <div className="row" key={idx}>
                <div className="left">
                  <div className="label">
                    {qty ? <span className="qty">{qty}×</span> : null}
                    <span>{safe(it.label)}</span>
                  </div>
                  {it.ref && <div className="ref">Ref: {safe(it.ref)}</div>}
                </div>
                {haveRight && (
                  <div className="right">
                    {unit && <div className="unit">{unit}</div>}
                    {sub  && <div className="sub">{sub}</div>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Totales */}
      {(typeof totals.net === 'number' ||
        hasTax || hasFees || hasDisc ||
        typeof totals.grandTotal === 'number') && (
        <>
          <div className="divider" />
          <div className="totals">
            {typeof totals.net === 'number' && (
              <div className="trow"><span>Subtotal</span><span>{fmtMoney(totals.net, ccy)}</span></div>
            )}
            {hasTax && (
              <div className="trow"><span>Impuestos</span><span>{fmtMoney(totals.tax!, ccy)}</span></div>
            )}
            {hasFees && (
              <div className="trow"><span>Cuotas/Fees</span><span>{fmtMoney(totals.fees!, ccy)}</span></div>
            )}
            {hasDisc && (
              <div className="trow"><span>Descuento</span><span>-{fmtMoney(Math.abs(totals.discount!), ccy)}</span></div>
            )}
            {typeof totals.grandTotal === 'number' && (
              <div className="trow grand">
                <span>Total</span>
                <span>{fmtMoney(totals.grandTotal, ccy)}</span>
              </div>
            )}
          </div>
        </>
      )}

      {/* Validez / Notas */}
      {(safe(validity.until) || safe(validity.notes)) && (
        <>
          <div className="divider" />
          <div className="notes">
            {safe(validity.until) && (
              <div className="line"><strong>Validez:</strong> {safe(validity.until)}</div>
            )}
            {safe(validity.notes) && (
              <div className="line"><strong>Notas y condiciones:</strong> {safe(validity.notes)}</div>
            )}
          </div>
        </>
      )}

      {/* Barra tipo código de barras */}
      <div className="barcode" aria-hidden="true" />

      <style jsx>{`
        .cv-quote {
          position: relative;
          width: 100%;
          max-width: 680px;
          background: #fff;
          color: #111;
          border-radius: 22px;
          box-shadow: 0 6px 28px rgba(0,0,0,.10);
          border: 1px solid rgba(0,0,0,.06);
          overflow: hidden;
        }
        .topband {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 14px 16px;
          background:
            repeating-linear-gradient(45deg, #bba36d 0 12px, #cbb885 12px 24px);
          color: #0a0a0a;
        }
        .brand { display: flex; align-items: center; gap: 12px; }
        .logo { height: 28px; width: auto; object-fit: contain; filter: drop-shadow(0 0 0 rgba(0,0,0,0)); }
        .title .k { letter-spacing: .06em; font-weight: 800; font-size: 12px; line-height: 1; }
        .title .sub { font-size: 11px; opacity: .85; }

        .ccy {
          font-weight: 800;
          font-size: 14px;
          background: #111;
          color: #fff;
          padding: 4px 8px;
          border-radius: 10px;
        }

        .perforation {
          position: relative;
          height: 18px;
          background: #fff;
        }
        .perforation::before,
        .perforation::after {
          content: "";
          position: absolute;
          top: 50%;
          width: 22px; height: 22px;
          background: #f7f7f7; /* color del fondo del chat */
          border-radius: 50%;
          transform: translateY(-50%);
          box-shadow: inset 0 0 0 1px rgba(0,0,0,.06);
        }
        .perforation::before { left: -11px; }
        .perforation::after  { right: -11px; }
        .dots {
          width: 100%;
          height: 1px;
          background-image: radial-gradient(#bbb 1px, transparent 1px);
          background-size: 6px 1px;
          background-repeat: repeat-x;
          background-position: center;
        }

        .items { padding: 10px 16px 4px; }
        .row { display: flex; justify-content: space-between; gap: 12px; padding: 10px 0; }
        .row + .row { border-top: 1px dashed rgba(0,0,0,.12); }
        .left .label { font-weight: 600; display: flex; gap: 6px; align-items: baseline; }
        .left .qty {
          background: #bba36d; color: #111; font-weight: 800;
          border-radius: 999px; padding: 2px 8px; font-size: 11px;
        }
        .left .ref { font-size: 11px; opacity: .7; margin-top: 2px; }
        .right { text-align: right; min-width: 120px; }
        .right .unit { font-size: 12px; opacity: .8; }
        .right .sub  { font-weight: 700; }

        .divider { height: 1px; background: rgba(0,0,0,.08); margin: 8px 16px; }

        .totals { padding: 4px 16px 8px; display: grid; gap: 6px; }
        .trow { display: flex; justify-content: space-between; }
        .trow span:first-child { opacity: .8; }
        .trow.grand {
          padding-top: 4px;
          border-top: 1px dashed rgba(0,0,0,.2);
          font-size: 16px;
          font-weight: 800;
        }

        .notes { padding: 4px 16px 14px; font-size: 13px; }
        .notes .line + .line { margin-top: 6px; }

        .barcode {
          height: 42px;
          background: repeating-linear-gradient(
            90deg,
            #111 0 2px,
            transparent 2px 4px,
            #111 4px 6px,
            transparent 6px 9px
          );
          opacity: .7;
          border-bottom-left-radius: 22px;
          border-bottom-right-radius: 22px;
        }

        @media (prefers-color-scheme: dark) {
          .cv-quote { background: #111; color: #e9e9e9; border-color: rgba(255,255,255,.07); }
          .perforation { background: #111; }
          .perforation::before, .perforation::after { background: #0b0b0b; box-shadow: inset 0 0 0 1px rgba(255,255,255,.08); }
          .dots { background-image: radial-gradient(#666 1px, transparent 1px); }
          .divider { background: rgba(255,255,255,.08); }
          .barcode { opacity: .5; }
          .left .qty { color: #0b0b0b; }
        }
      `}</style>
    </div>
  );
}
