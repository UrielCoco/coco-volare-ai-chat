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
  notes?: string;   // condiciones comerciales
};

export type QuoteData = {
  currency?: string;            // "USD" | "MXN" | "COP" | "EUR" ...
  items?: QuoteItem[];
  totals?: QuoteTotals;
  validity?: QuoteValidity;
  customer?: { name?: string; email?: string };
  meta?: { quoteId?: string; createdAt?: string; title?: string };
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
  return new Intl.NumberFormat(getLocaleFromCurrency(ccy), {
    style: 'currency',
    currency: (ccy || 'USD').toUpperCase(),
    maximumFractionDigits: 2
  }).format(n);
}
const safe = (x?: string | number) =>
  x === undefined || x === null ? '' : typeof x === 'string' ? x.trim() : String(x);

export default function QuoteCard({ data }: { data: QuoteData }) {
  const ccy = (data?.currency || 'USD').toUpperCase();
  const items = (data?.items || []).filter(it => (it?.label || '').trim() !== '');
  const totals = data?.totals || {};
  const validity = data?.validity || {};
  const hasFees = typeof totals.fees === 'number' && totals.fees !== 0;
  const hasTax  = typeof totals.tax  === 'number' && totals.tax  !== 0;
  const hasDisc = typeof totals.discount === 'number' && totals.discount !== 0;
  const showGrand = typeof totals.grandTotal === 'number';

  return (
    <div className="bp">
      {/* HERO dorado tipo boarding pass */}
      <div className="hero">
        <div className="heroInner">
          <div className="brand">
            {/* 👇 Logo desde /public/images/logo-coco-volare.png */}
            <img
              src="/images/logo-coco-volare.png"
              alt="Coco Volare"
              className="logo"
              draggable={false}
            />
            <div className="brandText">
              <div className="title">{data?.meta?.title || 'COTIZACIÓN'}</div>
              {data?.meta?.quoteId && <div className="subtitle">Folio · {safe(data.meta.quoteId)}</div>}
            </div>
          </div>

          <div className="priceBadge">
            <div className="ccy">{ccy}</div>
            {showGrand && <div className="price">{fmtMoney(totals.grandTotal!, ccy)}</div>}
          </div>
        </div>

        {/* Watermark grande tipo “CV ✈︎ USD” */}
        <div className="wm">
          <span className="wmLeft">CV</span>
          <span className="wmArrow">✈︎</span>
          <span className="wmRight">{ccy}</span>
        </div>
      </div>

      {/* Perforación lateral */}
      <div className="perforation" aria-hidden="true">
        <div className="dots" />
      </div>

      {/* INFO rápida (cliente + fechas) */}
      {(safe(data?.customer?.name) || safe(data?.meta?.createdAt) || safe(data?.customer?.email)) && (
        <div className="gridInfo">
          {safe(data?.customer?.name) && (
            <div className="info">
              <div className="label">Pasajero/Cliente</div>
              <div className="value">{safe(data?.customer?.name)}</div>
            </div>
          )}
          {safe(data?.meta?.createdAt) && (
            <div className="info">
              <div className="label">Fecha</div>
              <div className="value">{safe(data?.meta?.createdAt)}</div>
            </div>
          )}
          {safe(data?.customer?.email) && (
            <div className="info">
              <div className="label">Contacto</div>
              <div className="value">{safe(data?.customer?.email)}</div>
            </div>
          )}
        </div>
      )}

      {/* CONCEPTOS */}
      {items.length > 0 && (
        <div className="items">
          {items.map((it, idx) => {
            const qty = typeof it.qty === 'number' && it.qty > 0 ? it.qty : undefined;
            const unit = typeof it.unitPrice === 'number' ? fmtMoney(it.unitPrice, ccy) : '';
            const sub  = typeof it.subtotal  === 'number'
              ? fmtMoney(it.subtotal,  ccy)
              : (qty && typeof it.unitPrice === 'number' ? fmtMoney(qty * it.unitPrice, ccy) : '');

            return (
              <div className="row" key={idx}>
                <div className="left">
                  <div className="line1">
                    {qty ? <span className="chip">{qty}×</span> : null}
                    <span className="label">{safe(it.label)}</span>
                  </div>
                  {it.ref && <div className="ref">Ref: {safe(it.ref)}</div>}
                </div>
                <div className="right">
                  {unit && <div className="unit">{unit}</div>}
                  {sub  && <div className="sub">{sub}</div>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* TOTALES */}
      {(typeof totals.net === 'number' || hasTax || hasFees || hasDisc || showGrand) && (
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
            {showGrand && (
              <div className="trow grand">
                <span>Total</span>
                <span>{fmtMoney(totals.grandTotal!, ccy)}</span>
              </div>
            )}
          </div>
        </>
      )}

      {/* Notas / Condiciones */}
      {(safe(validity.until) || safe(validity.notes)) && (
        <>
          <div className="divider" />
          <div className="notes">
            {safe(validity.until) && <div className="line"><strong>Validez:</strong> {safe(validity.until)}</div>}
            {safe(validity.notes) && <div className="line"><strong>Notas y condiciones:</strong> {safe(validity.notes)}</div>}
          </div>
        </>
      )}

      {/* Código de barras decorativo */}
      <div className="barcode" aria-hidden="true" />

      <style jsx>{`
        .bp {
          position: relative;
          width: 100%;
          background: #fff;
          color: #111;
          border-radius: 22px;
          border: 1px solid rgba(0,0,0,.06);
          box-shadow: 0 6px 28px rgba(0,0,0,.10);
          overflow: hidden;
        }

        .hero { position: relative; background: #bba36d; color: #0a0a0a; padding: 16px; }
        .heroInner { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
        .brand { display: flex; align-items: center; gap: 12px; }
        .logo { height: 28px; width: auto; object-fit: contain; }
        .brandText .title { font-weight: 900; font-size: 13px; letter-spacing: .08em; }
        .brandText .subtitle { font-size: 11px; opacity: .9; }

        .priceBadge { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; }
        .priceBadge .ccy { font-weight: 800; font-size: 11px; background: #111; color: #fff; padding: 3px 8px; border-radius: 999px; letter-spacing: .05em; }
        .priceBadge .price { font-weight: 900; font-size: 18px; line-height: 1; }

        .wm { position: absolute; inset: 0; pointer-events: none; display: flex; align-items: center; justify-content: center; gap: 22px; opacity: .15; font-weight: 900; letter-spacing: .06em; }
        .wmLeft, .wmRight { font-size: 56px; line-height: 1; }
        .wmArrow { font-size: 32px; }

        .perforation { position: relative; height: 18px; background: #fff; }
        .perforation::before, .perforation::after { content: ""; position: absolute; top: 50%; width: 22px; height: 22px; background: #f7f7f7; border-radius: 50%; transform: translateY(-50%); box-shadow: inset 0 0 0 1px rgba(0,0,0,.06); }
        .perforation::before { left: -11px; }
        .perforation::after  { right: -11px; }
        .dots { width: 100%; height: 1px; background-image: radial-gradient(#bbb 1px, transparent 1px); background-size: 6px 1px; background-repeat: repeat-x; background-position: center; }

        .gridInfo { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; padding: 12px 16px 4px; }
        .info .label { font-size: 11px; opacity: .65; }
        .info .value { font-weight: 700; }

        .items { padding: 6px 16px 4px; }
        .row { display: flex; justify-content: space-between; gap: 12px; padding: 10px 0; }
        .row + .row { border-top: 1px dashed rgba(0,0,0,.12); }
        .left .line1 { font-weight: 700; display: flex; gap: 6px; align-items: baseline; }
        .left .chip { background: #bba36d; color: #111; font-weight: 900; border-radius: 999px; padding: 2px 8px; font-size: 11px; }
        .left .ref { font-size: 11px; opacity: .7; margin-top: 2px; }
        .right { text-align: right; min-width: 140px; }
        .right .unit { font-size: 12px; opacity: .8; }
        .right .sub  { font-weight: 900; }

        .divider { height: 1px; background: rgba(0,0,0,.08); margin: 8px 16px; }

        .totals { padding: 4px 16px 8px; display: grid; gap: 6px; }
        .trow { display: flex; justify-content: space-between; }
        .trow span:first-child { opacity: .8; }
        .trow.grand { padding-top: 6px; border-top: 1px dashed rgba(0,0,0,.22); font-size: 16px; font-weight: 900; }

        .notes { padding: 0 16px 14px; font-size: 13px; }
        .notes .line + .line { margin-top: 6px; }

        .barcode { height: 46px; background: repeating-linear-gradient(90deg,#111 0 2px,transparent 2px 5px,#111 5px 7px,transparent 7px 10px); opacity: .7; border-bottom-left-radius: 22px; border-bottom-right-radius: 22px; }

        @media (max-width: 520px) {
          .gridInfo { grid-template-columns: 1fr; }
          .right { min-width: 120px; }
        }

        @media (prefers-color-scheme: dark) {
          .bp { background: #111; color: #e9e9e9; border-color: rgba(255,255,255,.07); }
          .perforation { background: #111; }
          .perforation::before, .perforation::after { background: #0b0b0b; box-shadow: inset 0 0 0 1px rgba(255,255,255,.08); }
          .dots { background-image: radial-gradient(#666 1px, transparent 1px); }
          .divider { background: rgba(255,255,255,.08); }
          .barcode { opacity: .5; }
        }
      `}</style>
    </div>
  );
}
