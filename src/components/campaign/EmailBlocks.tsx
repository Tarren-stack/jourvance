import React, { useState } from 'react';
import { authHeaders } from '../../lib/firebase';
import { card, field, ghostBtn, label } from './emailChrome';

export type DisplayClause = { kind: 'profile' | 'event_field'; field: string; op: 'eq' | 'neq' | 'set' | 'unset' | 'contains'; value?: string };
export type DisplayGroup = { join: 'all' | 'any'; clauses: DisplayClause[] };
export type MailDisplay = { show?: DisplayGroup; hide?: DisplayGroup };
export type MailBlock = {
  id: string;
  kind: 'heading' | 'text' | 'button' | 'divider' | 'image' | 'html' | 'split' | 'columns' | 'table' | 'spacer' | 'social' | 'header' | 'video' | 'product' | 'coupon';
  text?: string;
  label?: string;
  url?: string;
  alt?: string;
  href?: string;
  level?: number;
  background?: string;
  padding?: number;
  color?: string;
  radius?: number;
  style?: string;
  thickness?: number;
  width?: string;
  align?: string;
  eventField?: string;
  stack?: boolean;
  widths?: number[];
  cells?: { kind: 'text' | 'image'; text?: string; url?: string; alt?: string; href?: string }[];
  columns?: { blocks: MailBlock[] }[];
  headers?: string[];
  rows?: string[][];
  repeat?: string;
  height?: number;
  links?: { network?: string; label?: string; url: string }[];
  logoUrl?: string;
  logoAlt?: string;
  thumbnail?: string;
  products?: { id?: string; title?: string; image?: string; price?: string; compareAt?: string; url?: string; currency?: string; buttonLabel?: string }[];
  mode?: 'static' | 'feed';
  feed?: { source?: string; fallback?: string; limit?: number; category?: string; minPrice?: number | null; maxPrice?: number | null; minStock?: number | null; hideMissingImage?: boolean; hideOutOfStock?: boolean; hidePurchased?: boolean; hideTrigger?: boolean };
  name?: string;
  discountType?: string;
  value?: number;
  prefix?: string;
  pageSlug?: string;
  display?: MailDisplay;
};
export type LibraryRow = { id: string; name: string; block: MailBlock };
type CatalogProduct = { id: string; title?: string; image?: string; price?: string; compareAt?: string; url?: string; currency?: string };

const ADD: { kind: MailBlock['kind']; label: string }[] = [
  { kind: 'heading', label: 'heading' },
  { kind: 'text', label: 'text' },
  { kind: 'button', label: 'button' },
  { kind: 'divider', label: 'divider' },
  { kind: 'image', label: 'image' },
  { kind: 'html', label: 'HTML' },
  { kind: 'columns', label: 'columns' },
  { kind: 'split', label: 'split' },
  { kind: 'table', label: 'table' },
  { kind: 'spacer', label: 'spacer' },
  { kind: 'social', label: 'social links' },
  { kind: 'header', label: 'header' },
  { kind: 'video', label: 'video' },
  { kind: 'product', label: 'product' },
  { kind: 'coupon', label: 'coupon' }
];

function nextId() {
  return `b_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function cloneBlock(block: MailBlock): MailBlock {
  const copy: MailBlock = { ...block, id: nextId(), columns: block.columns?.map((column) => ({ blocks: column.blocks.map(cloneBlock) })) };
  return copy;
}

function blank(kind: MailBlock['kind']): MailBlock {
  const id = nextId();
  if (kind === 'button') return { id, kind, label: 'Open', url: '' };
  if (kind === 'split') return { id, kind, widths: [50, 50], stack: true, cells: [{ kind: 'text', text: '' }, { kind: 'text', text: '' }] };
  if (kind === 'columns') return { id, kind, stack: true, columns: [{ blocks: [{ id: `${id}a`, kind: 'text', text: '' }] }, { blocks: [{ id: `${id}b`, kind: 'text', text: '' }] }] };
  if (kind === 'table') return { id, kind, repeat: 'event.line_items', headers: ['Item', 'Qty'], rows: [['{{ item.title }}', '{{ item.quantity }}']] };
  if (kind === 'spacer') return { id, kind, height: 24 };
  if (kind === 'social') return { id, kind, links: [{ network: 'instagram', url: '' }] };
  if (kind === 'header') return { id, kind, logoUrl: '', links: [{ label: 'Shop', url: '' }] };
  if (kind === 'coupon') return { id, kind, name: 'Welcome', discountType: 'percentage', value: 10, prefix: 'WELCOME' };
  if (kind === 'divider') return { id, kind, style: 'solid' };
  if (kind === 'text') return { id, kind, text: '', level: 0 };
  if (kind === 'product') return { id, kind, products: [] };
  return { id, kind, text: '', url: '' };
}

function RuleFields({ title, group, onChange }: { title: string; group?: DisplayGroup; onChange: (next?: DisplayGroup) => void }) {
  const clauses = group?.clauses || [];
  const update = (index: number, patch: Partial<DisplayClause>) => {
    const next = clauses.map((clause, i) => i === index ? { ...clause, ...patch } : clause);
    onChange({ join: group?.join || 'all', clauses: next });
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={label}>{title}</span>
      {clauses.map((clause, index) => (
        <div key={index} style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <select style={{ ...field, width: 'auto' }} aria-label={`${title} source ${index + 1}`} value={clause.kind} onChange={(e) => update(index, { kind: e.target.value as DisplayClause['kind'] })}>
            <option value="profile">Profile property</option>
            <option value="event_field">Event field</option>
          </select>
          <input style={{ ...field, width: 120 }} aria-label={`${title} field ${index + 1}`} value={clause.field} placeholder="field" onChange={(e) => update(index, { field: e.target.value })} />
          <select style={{ ...field, width: 'auto' }} aria-label={`${title} operator ${index + 1}`} value={clause.op} onChange={(e) => update(index, { op: e.target.value as DisplayClause['op'] })}>
            <option value="eq">equals</option>
            <option value="neq">does not equal</option>
            <option value="contains">contains</option>
            <option value="set">is set</option>
            <option value="unset">is empty</option>
          </select>
          {clause.op !== 'set' && clause.op !== 'unset' && (
            <input style={{ ...field, width: 120 }} aria-label={`${title} value ${index + 1}`} value={clause.value || ''} placeholder="value" onChange={(e) => update(index, { value: e.target.value })} />
          )}
          <button type="button" style={ghostBtn} onClick={() => onChange(clauses.length === 1 ? undefined : { join: group?.join || 'all', clauses: clauses.filter((_, i) => i !== index) })}>Remove rule</button>
        </div>
      ))}
      {clauses.length > 1 && (
        <select style={{ ...field, width: 'auto' }} aria-label={`${title} match`} value={group?.join || 'all'} onChange={(e) => onChange({ join: e.target.value as 'all' | 'any', clauses })}>
          <option value="all">All of these</option>
          <option value="any">Any of these</option>
        </select>
      )}
      {clauses.length < 4 && (
        <button type="button" style={ghostBtn} onClick={() => onChange({ join: group?.join || 'all', clauses: [...clauses, { kind: 'profile', field: '', op: 'eq', value: '' }] })}>Add {title.toLowerCase()} rule</button>
      )}
    </div>
  );
}

export const BlockEditor: React.FC<{
  blocks: MailBlock[];
  onChange: (next: MailBlock[]) => void;
  library?: LibraryRow[];
  onSaveCopy?: (block: MailBlock) => void;
  onDeleteCopy?: (id: string) => void;
}> = ({ blocks, onChange, library = [], onSaveCopy, onDeleteCopy }) => {
  const update = (index: number, patch: Partial<MailBlock>) => {
    onChange(blocks.map((block, i) => i === index ? { ...block, ...patch } : block));
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {blocks.map((block, index) => (
        <div key={block.id} style={{ ...card, padding: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
            <span style={label}>{block.kind}</span>
            <span style={{ display: 'flex', gap: 6 }}>
              {onSaveCopy && <button type="button" style={ghostBtn} onClick={() => onSaveCopy(block)}>Save copy</button>}
              <button type="button" style={ghostBtn} onClick={() => onChange(blocks.filter((_, i) => i !== index))}>Remove</button>
            </span>
          </div>
          <BlockFields block={block} onChange={(patch) => update(index, patch)} />
          <div style={{ marginTop: 8 }}>
            <RuleFields title="Show when" group={block.display?.show} onChange={(show) => update(index, { display: { ...block.display, show } })} />
            <RuleFields title="Hide when" group={block.display?.hide} onChange={(hide) => update(index, { display: { ...block.display, hide } })} />
            <p style={{ margin: '6px 0 0', fontSize: 12, color: '#9ca3af' }}>A block that matches both a show rule and a hide rule stays hidden. A missing field does not match.</p>
          </div>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {ADD.map((item) => (
          <button key={item.kind} type="button" style={ghostBtn} onClick={() => onChange([...blocks, blank(item.kind)])}>Add {item.label}</button>
        ))}
      </div>
      {library.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={label}>Saved blocks</span>
          {library.map((row) => (
            <div key={row.id} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ color: '#e5e7eb', fontSize: 13 }}>{row.name}</span>
              <button type="button" style={ghostBtn} onClick={() => onChange([...blocks, cloneBlock(row.block)])}>Insert copy</button>
              {onDeleteCopy && <button type="button" style={ghostBtn} onClick={() => onDeleteCopy(row.id)}>Delete saved copy</button>}
            </div>
          ))}
          <p style={{ margin: 0, fontSize: 12, color: '#9ca3af' }}>Inserting a saved block copies it into this letter. Later edits to the saved copy do not change letters that already used it.</p>
        </div>
      )}
    </div>
  );
};

const BlockFields: React.FC<{ block: MailBlock; onChange: (patch: Partial<MailBlock>) => void }> = ({ block, onChange }) => {
  if (block.kind === 'heading') return <textarea style={{ ...field, minHeight: 44 }} aria-label="Heading" value={block.text || ''} onChange={(e) => onChange({ text: e.target.value })} />;
  if (block.kind === 'text') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <label style={label}>Level
          <select style={{ ...field, marginTop: 4 }} value={block.level || 0} onChange={(e) => onChange({ level: Number(e.target.value) })}>
            <option value={0}>Paragraph</option>
            <option value={1}>Heading 1</option>
            <option value={2}>Heading 2</option>
            <option value={3}>Heading 3</option>
            <option value={4}>Heading 4</option>
          </select>
        </label>
        <textarea style={{ ...field, minHeight: 90 }} aria-label="Text" value={block.text || ''} onChange={(e) => onChange({ text: e.target.value })} />
        <input style={field} aria-label="Background color" value={block.background || ''} placeholder="Background #hex" onChange={(e) => onChange({ background: e.target.value })} />
      </div>
    );
  }
  if (block.kind === 'button') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <input style={field} aria-label="Button label" value={block.label || ''} placeholder="Button label" onChange={(e) => onChange({ label: e.target.value })} />
        <input style={field} aria-label="Button link" value={block.url || ''} placeholder="https:// link" onChange={(e) => onChange({ url: e.target.value })} />
        <input style={field} aria-label="Button color" value={block.color || ''} placeholder="Color #111111 when empty" onChange={(e) => onChange({ color: e.target.value })} />
      </div>
    );
  }
  if (block.kind === 'divider') {
    return (
      <select style={field} aria-label="Divider style" value={block.style || 'solid'} onChange={(e) => onChange({ style: e.target.value })}>
        <option value="solid">Solid</option>
        <option value="dashed">Dashed</option>
        <option value="dotted">Dotted</option>
      </select>
    );
  }
  if (block.kind === 'image') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <input style={field} aria-label="Image address" value={block.url || ''} placeholder="https:// image address" onChange={(e) => onChange({ url: e.target.value })} />
        <input style={field} aria-label="Image description" value={block.alt || ''} placeholder="Description" onChange={(e) => onChange({ alt: e.target.value })} />
        <input style={field} aria-label="Image link" value={block.href || ''} placeholder="https:// link when the image is clicked" onChange={(e) => onChange({ href: e.target.value })} />
        <input style={field} aria-label="Event field for the image address" value={block.eventField || ''} placeholder="Event field used as the image address" onChange={(e) => onChange({ eventField: e.target.value })} />
        <select style={field} aria-label="Image alignment" value={block.align || 'left'} onChange={(e) => onChange({ align: e.target.value })}>
          <option value="left">Left</option>
          <option value="center">Center</option>
          <option value="right">Right</option>
        </select>
      </div>
    );
  }
  if (block.kind === 'html') return <textarea style={{ ...field, minHeight: 120 }} aria-label="HTML" value={block.text || ''} onChange={(e) => onChange({ text: e.target.value })} />;
  if (block.kind === 'columns') {
    const columns = block.columns || [];
    const setColumn = (col: number, blocks: MailBlock[]) => onChange({ columns: columns.map((item, i) => i === col ? { blocks } : item) });
    return (
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {columns.map((column, col) => (
          <div key={col} style={{ flex: '1 1 200px', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={label}>Column {col + 1}</span>
            {column.blocks.map((child, childIndex) => (
              <div key={child.id}>
                {child.kind === 'button' ? (
                  <>
                    <input style={field} aria-label={`Column ${col + 1} button label`} value={child.label || ''} placeholder="Button label" onChange={(e) => setColumn(col, column.blocks.map((item, i) => i === childIndex ? { ...item, label: e.target.value } : item))} />
                    <input style={{ ...field, marginTop: 4 }} aria-label={`Column ${col + 1} button link`} value={child.url || ''} placeholder="https:// link" onChange={(e) => setColumn(col, column.blocks.map((item, i) => i === childIndex ? { ...item, url: e.target.value } : item))} />
                  </>
                ) : child.kind === 'image' ? (
                  <input style={field} aria-label={`Column ${col + 1} image`} value={child.url || ''} placeholder="https:// image" onChange={(e) => setColumn(col, column.blocks.map((item, i) => i === childIndex ? { ...item, url: e.target.value } : item))} />
                ) : (
                  <textarea style={{ ...field, minHeight: 70 }} aria-label={`Column ${col + 1} text`} value={child.text || ''} onChange={(e) => setColumn(col, column.blocks.map((item, i) => i === childIndex ? { ...item, text: e.target.value } : item))} />
                )}
                <button type="button" style={{ ...ghostBtn, marginTop: 4 }} onClick={() => setColumn(col, column.blocks.filter((_, i) => i !== childIndex))}>Remove from column</button>
              </div>
            ))}
            <button type="button" style={ghostBtn} onClick={() => setColumn(col, [...column.blocks, { id: nextId(), kind: 'text', text: '' }])}>Add text</button>
            <button type="button" style={ghostBtn} onClick={() => setColumn(col, [...column.blocks, { id: nextId(), kind: 'button', label: 'Open', url: '' }])}>Add button</button>
          </div>
        ))}
        {columns.length < 4 && <button type="button" style={ghostBtn} onClick={() => onChange({ columns: [...columns, { blocks: [{ id: nextId(), kind: 'text', text: '' }] }] })}>Add column</button>}
      </div>
    );
  }
  if (block.kind === 'split') {
    const cells = block.cells || [{ kind: 'text' as const, text: '' }, { kind: 'text' as const, text: '' }];
    return (
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {cells.map((cell, i) => (
          <div key={i} style={{ flex: '1 1 180px', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={label}>Side {i + 1}</span>
            <select style={field} aria-label={`Split side ${i + 1} type`} value={cell.kind} onChange={(e) => onChange({ cells: cells.map((item, index) => index === i ? { ...item, kind: e.target.value as 'text' | 'image' } : item) })}>
              <option value="text">Text</option>
              <option value="image">Image</option>
            </select>
            {cell.kind === 'image'
              ? <input style={field} aria-label={`Split side ${i + 1} image`} value={cell.url || ''} placeholder="https:// image" onChange={(e) => onChange({ cells: cells.map((item, index) => index === i ? { ...item, url: e.target.value } : item) })} />
              : <textarea style={{ ...field, minHeight: 80 }} aria-label={`Split side ${i + 1} text`} value={cell.text || ''} onChange={(e) => onChange({ cells: cells.map((item, index) => index === i ? { ...item, text: e.target.value } : item) })} />}
          </div>
        ))}
      </div>
    );
  }
  if (block.kind === 'table') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <label style={{ color: '#e5e7eb', fontSize: 13 }}>
          <input type="checkbox" checked={block.repeat === 'event.line_items'} onChange={(e) => onChange({ repeat: e.target.checked ? 'event.line_items' : '' })} /> Repeat for each item in the order
        </label>
        <input style={field} aria-label="Table headers" value={(block.headers || []).join(', ')} placeholder="Headers, separated by commas" onChange={(e) => onChange({ headers: e.target.value.split(',').map((cell) => cell.trim()).slice(0, 8) })} />
        <input style={field} aria-label="Table row" value={(block.rows?.[0] || []).join(' | ')} placeholder="{{ item.title }} | {{ item.quantity }}" onChange={(e) => onChange({ rows: [e.target.value.split('|').map((cell) => cell.trim()).slice(0, 8)] })} />
      </div>
    );
  }
  if (block.kind === 'spacer') return <input style={field} type="number" min={8} max={120} aria-label="Spacer height" value={block.height || 24} onChange={(e) => onChange({ height: Number(e.target.value) })} />;
  if (block.kind === 'social') {
    const links = block.links || [];
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {links.map((link, i) => (
          <div key={i} style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <select style={{ ...field, width: 'auto' }} aria-label={`Social network ${i + 1}`} value={link.network || 'instagram'} onChange={(e) => onChange({ links: links.map((item, index) => index === i ? { ...item, network: e.target.value } : item) })}>
              {['facebook', 'instagram', 'x', 'tiktok', 'youtube', 'pinterest', 'linkedin'].map((network) => <option key={network} value={network}>{network}</option>)}
            </select>
            <input style={{ ...field, flex: 1 }} aria-label={`Social link ${i + 1}`} value={link.url} placeholder="https://" onChange={(e) => onChange({ links: links.map((item, index) => index === i ? { ...item, url: e.target.value } : item) })} />
          </div>
        ))}
      </div>
    );
  }
  if (block.kind === 'header') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <input style={field} aria-label="Logo address" value={block.logoUrl || ''} placeholder="https:// logo" onChange={(e) => onChange({ logoUrl: e.target.value })} />
        {(block.links || []).map((link, i) => (
          <div key={i} style={{ display: 'flex', gap: 6 }}>
            <input style={field} aria-label={`Header link label ${i + 1}`} value={link.label || ''} placeholder="Label" onChange={(e) => onChange({ links: (block.links || []).map((item, index) => index === i ? { ...item, label: e.target.value } : item) })} />
            <input style={field} aria-label={`Header link ${i + 1}`} value={link.url} placeholder="https://" onChange={(e) => onChange({ links: (block.links || []).map((item, index) => index === i ? { ...item, url: e.target.value } : item) })} />
          </div>
        ))}
      </div>
    );
  }
  if (block.kind === 'video') return <input style={field} aria-label="Video address" value={block.url || ''} placeholder="https:// YouTube, Vimeo, TikTok, or another video" onChange={(e) => onChange({ url: e.target.value })} />;
  if (block.kind === 'coupon') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <input style={field} aria-label="Coupon name" value={block.name || ''} placeholder="Name" onChange={(e) => onChange({ name: e.target.value })} />
        <select style={field} aria-label="Coupon type" value={block.discountType || 'percentage'} onChange={(e) => onChange({ discountType: e.target.value })}>
          <option value="percentage">Percent off</option>
          <option value="fixed_amount">Fixed amount off</option>
          <option value="free_shipping">Free shipping</option>
        </select>
        {block.discountType !== 'free_shipping' && <input style={field} type="number" aria-label="Coupon amount" value={block.value || 0} onChange={(e) => onChange({ value: Number(e.target.value) })} />}
        <input style={field} aria-label="Coupon prefix" value={block.prefix || ''} placeholder="Prefix" onChange={(e) => onChange({ prefix: e.target.value })} />
        <PageLink ariaLabel="Coupon page link" slug={block.pageSlug || ''} onChange={(pageSlug) => onChange({ pageSlug })} />
        <p style={{ margin: 0, fontSize: 12, color: '#9ca3af' }}>Preview shows the word Code. A code is created for each person when the letter sends, and a retry uses that same code. A Jourvance page link includes this person’s visitor id when one is stored.</p>
      </div>
    );
  }
  if (block.kind === 'product') return <ProductFields block={block} onChange={onChange} />;
  return null;
};

const PageLink: React.FC<{ ariaLabel: string; slug: string; onChange: (slug: string) => void }> = ({ ariaLabel, slug, onChange }) => {
  const [pages, setPages] = useState<{ slug: string; name: string }[]>([]);
  const [notice, setNotice] = useState('');
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      const data = await fetch('/api/email/pages', { headers: await authHeaders() }).then((res) => res.json()).catch(() => ({}));
      if (cancelled) return;
      const rows = Array.isArray(data?.pages) ? data.pages : [];
      setPages(rows);
      if (!rows.length) setNotice('Publish a landing page to link this block to it.');
    })();
    return () => { cancelled = true; };
  }, []);
  return (
    <label style={label}>
      Jourvance page
      <select aria-label={ariaLabel} style={field} value={slug} onChange={(e) => onChange(e.target.value)}>
        <option value="">Keep the store link</option>
        {pages.map((page) => <option key={page.slug} value={page.slug}>{page.name}</option>)}
      </select>
      {notice && !pages.length && <span style={{ display: 'block', fontSize: 12, color: '#9ca3af', fontWeight: 400 }}>{notice}</span>}
    </label>
  );
};

const FEED_CHOICES = [
  ['best_3', 'Best sellers, last 3 days'],
  ['best_90', 'Best sellers, last 90 days'],
  ['newest', 'Newest'],
  ['copurchase', 'Co-purchase'],
  ['viewed', 'Recently viewed'],
  ['cart', 'Added to cart'],
  ['checkout', 'This checkout']
] as const;

const ProductFields: React.FC<{ block: MailBlock; onChange: (patch: Partial<MailBlock>) => void }> = ({ block, onChange }) => {
  const products = block.products || [];
  const feed = block.feed || { source: 'best_90', fallback: 'best_90', limit: 3 };
  const personal = feed.source === 'copurchase' || feed.source === 'viewed' || feed.source === 'cart';
  const [catalog, setCatalog] = useState<CatalogProduct[] | null>(null);
  const [notice, setNotice] = useState('');
  const [preview, setPreview] = useState<{ title?: string; price?: string }[]>([]);
  const load = async () => {
    const data = await fetch('/api/email/products', { headers: await authHeaders() }).then((res) => res.json()).catch(() => ({}));
    setCatalog(Array.isArray(data?.products) ? data.products : []);
    setNotice(data?.notice || (Array.isArray(data?.products) && data.products.length ? '' : 'No products were returned.'));
  };
  const previewFeed = async () => {
    const res = await fetch('/api/email/feed-preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
      body: JSON.stringify({ feed })
    });
    const data = await res.json().catch(() => ({}));
    setPreview(Array.isArray(data?.products) ? data.products : []);
    setNotice(data?.notice || (data?.label ? data.label : ''));
  };
  const patchFeed = (patch: NonNullable<MailBlock['feed']>) => onChange({ mode: 'feed', feed: { ...feed, ...patch } });
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label style={label}>
        Products
        <select aria-label="Product source" style={field} value={block.mode === 'feed' ? 'feed' : 'static'} onChange={(e) => onChange(e.target.value === 'feed' ? { mode: 'feed', feed } : { mode: 'static' })}>
          <option value="static">Chosen products</option>
          <option value="feed">A feed from this store</option>
        </select>
      </label>
      {block.mode === 'feed' && (
        <>
          <select aria-label="Feed" style={field} value={feed.source || 'best_90'} onChange={(e) => patchFeed({ source: e.target.value })}>
            {FEED_CHOICES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          {personal && (
            <select aria-label="Fallback feed" style={field} value={feed.fallback === 'best_3' ? 'best_3' : 'best_90'} onChange={(e) => patchFeed({ fallback: e.target.value })}>
              <option value="best_90">Fallback: best sellers, last 90 days</option>
              <option value="best_3">Fallback: best sellers, last 3 days</option>
            </select>
          )}
          <input style={field} aria-label="Category" placeholder="Category" value={feed.category || ''} onChange={(e) => patchFeed({ category: e.target.value })} />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input style={{ ...field, flex: 1 }} aria-label="Minimum price" type="number" placeholder="Min price" value={feed.minPrice ?? ''} onChange={(e) => patchFeed({ minPrice: e.target.value === '' ? null : Number(e.target.value) })} />
            <input style={{ ...field, flex: 1 }} aria-label="Maximum price" type="number" placeholder="Max price" value={feed.maxPrice ?? ''} onChange={(e) => patchFeed({ maxPrice: e.target.value === '' ? null : Number(e.target.value) })} />
            <input style={{ ...field, flex: 1 }} aria-label="Minimum stock" type="number" placeholder="Min stock" value={feed.minStock ?? ''} onChange={(e) => patchFeed({ minStock: e.target.value === '' ? null : Number(e.target.value) })} />
          </div>
          {([
            ['hideMissingImage', 'Hide products with no image'],
            ['hideOutOfStock', 'Hide products that are out of stock'],
            ['hidePurchased', 'Hide products this person already bought'],
            ['hideTrigger', 'Hide the product that started the flow']
          ] as const).map(([key, text]) => (
            <label key={key} style={{ fontSize: 13, color: '#e5e7eb', display: 'flex', gap: 8, alignItems: 'center' }}>
              <input type="checkbox" checked={feed[key] !== false} onChange={(e) => patchFeed({ [key]: e.target.checked })} />
              {text}
            </label>
          ))}
          <button type="button" style={ghostBtn} onClick={previewFeed}>Preview this feed</button>
          <PageLink ariaLabel="Product page link" slug={block.pageSlug || ''} onChange={(pageSlug) => onChange({ mode: 'feed', pageSlug })} />
          <p style={{ margin: 0, fontSize: 12, color: '#9ca3af' }}>Best sellers are ranked by units on this store’s orders. Newest needs the created date the store returned. Co-purchase, recently viewed, and added to cart use a best-seller fallback. A checkout shows that checkout, not a 90-day view list. The variant that passed the filters is the one pictured. A Jourvance page link includes this person’s visitor id when one is stored.</p>
          {preview.map((product) => (
            <p key={`${product.title || ''}${product.price || ''}`} style={{ margin: 0, fontSize: 13, color: '#e5e7eb' }}>{product.title || 'Product'}{product.price ? ` · ${product.price}` : ''}</p>
          ))}
        </>
      )}
      {block.mode !== 'feed' && products.map((product, index) => (
        <div key={`${product.id || product.title || index}`} style={{ color: '#e5e7eb', fontSize: 13 }}>
          {product.title || 'Product'}{product.price ? ` · ${product.price}${product.currency ? ` ${product.currency}` : ''}` : ''}{product.compareAt ? ` · was ${product.compareAt}` : ''}
          <button type="button" style={{ ...ghostBtn, marginLeft: 8 }} onClick={() => onChange({ products: products.filter((_, i) => i !== index) })}>Remove</button>
        </div>
      ))}
      {block.mode !== 'feed' && <PageLink ariaLabel="Product page link" slug={block.pageSlug || ''} onChange={(pageSlug) => onChange({ mode: 'static', pageSlug })} />}
      {block.mode !== 'feed' && <button type="button" style={ghostBtn} onClick={load}>Choose from the store</button>}
      {notice && <p style={{ margin: 0, fontSize: 12, color: '#9ca3af' }}>{notice}</p>}
      {block.mode !== 'feed' && catalog && catalog.map((product) => (
        <button key={product.id} type="button" style={{ ...ghostBtn, textAlign: 'left' }} onClick={() => {
          if (products.length >= 9) {
            setNotice('A letter can show 9 products.');
            return;
          }
          const row: NonNullable<MailBlock['products']>[number] = {};
          if (product.id) row.id = product.id;
          if (product.title) row.title = product.title;
          if (product.image) row.image = product.image;
          if (product.price) row.price = product.price;
          if (product.compareAt) row.compareAt = product.compareAt;
          if (product.url) row.url = product.url;
          if (product.currency) row.currency = product.currency;
          if (product.url) row.buttonLabel = 'View';
          onChange({ mode: 'static', products: [...products, row] });
        }}>{product.title || product.id}</button>
      ))}
    </div>
  );
};
