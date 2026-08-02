import { useCallback, useEffect, useState } from 'react';
import { THEME_PRESETS, readableTextOn } from '@salon/shared';
import { apiJson as api } from './api';
import { s } from './styles';

const SECTION_TYPES = [
  'hero', 'services', 'gallery', 'team', 'offers', 'testimonials', 'hours', 'contact', 'cta',
] as const;
type SectionType = (typeof SECTION_TYPES)[number];

/** The editable fields shown per section type. Live-data types need only a heading. */
const FIELDS: Record<SectionType, string[]> = {
  hero: ['headline', 'subhead', 'cta', 'image'],
  services: ['heading'],
  gallery: ['heading'],
  team: ['heading'],
  offers: ['heading', 'body'],
  testimonials: ['heading', 'quote'],
  hours: ['heading', 'hours'],
  contact: ['heading', 'address', 'phone'],
  cta: ['heading', 'cta'],
};

interface Section {
  id: string;
  type: SectionType;
  position: number;
  enabled: boolean;
  data: Record<string, string>;
  publishedAt?: string | null;
}

/**
 * The owner's site editor: pick an accent (contrast is enforced for them), and
 * arrange the nine section types. Editing changes the draft; Publish is what
 * pushes it live. Not a page builder — fixed section types only.
 */
export function SiteView() {
  const [primary, setPrimary] = useState('#0f5da8');
  const [sections, setSections] = useState<Section[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [addType, setAddType] = useState<SectionType>('hero');

  const load = useCallback(async () => {
    const settings = await api<{ theme?: { primary?: string } }>('/site/settings');
    if (settings.theme?.primary) setPrimary(settings.theme.primary);
    const secs = await api<Section[]>('/site/sections');
    setSections(secs);
  }, []);

  useEffect(() => {
    void load().catch(() => setMessage('Could not load the site.'));
  }, [load]);

  const onAccent = safeReadable(primary);

  async function saveTheme() {
    try {
      await api('/site/settings', { method: 'PUT', body: JSON.stringify({ theme: { primary } }) });
      setMessage('Theme saved.');
    } catch (e) {
      setMessage(String(e).replace(/^Error:\s*/, '').slice(0, 160));
    }
  }

  function addSection() {
    setSections((prev) => [
      ...prev,
      { id: crypto.randomUUID(), type: addType, position: prev.length, enabled: true, data: {} },
    ]);
  }

  function update(id: string, patch: Partial<Section>) {
    setSections((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }
  function setField(id: string, key: string, value: string) {
    setSections((prev) => prev.map((s) => (s.id === id ? { ...s, data: { ...s.data, [key]: value } } : s)));
  }
  function move(id: string, dir: -1 | 1) {
    setSections((prev) => {
      const i = prev.findIndex((s) => s.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      const a = next[i]!;
      next[i] = next[j]!;
      next[j] = a;
      return next.map((s, k) => ({ ...s, position: k }));
    });
  }
  function remove(id: string) {
    setSections((prev) => prev.filter((s) => s.id !== id).map((s, k) => ({ ...s, position: k })));
  }

  async function saveDraft() {
    const payload = sections.map((s, k) => ({
      id: s.id, type: s.type, position: k, enabled: s.enabled, data: s.data,
    }));
    const saved = await api<Section[]>('/site/sections', { method: 'PUT', body: JSON.stringify({ sections: payload }) });
    setSections(saved);
    setMessage('Draft saved.');
  }

  async function publish() {
    await saveDraft();
    await api('/site/publish', { method: 'POST' });
    setMessage('Published — your public site is updated.');
    await load();
  }

  return (
    <>
      <h1 style={s.title}>Site</h1>
      {message && <div style={{ ...s.banner, background: 'var(--blue-wash)', color: 'var(--signal-blue)' }}>{message}</div>}

      <div style={s.panel}>
        <p style={s.panelTitle}>Accent colour</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
          {THEME_PRESETS.map((p) => (
            <button
              key={p.hex}
              title={p.name}
              onClick={() => setPrimary(p.hex)}
              style={{
                width: 34, height: 34, borderRadius: 6, cursor: 'pointer',
                background: p.hex,
                border: primary.toLowerCase() === p.hex.toLowerCase() ? '3px solid var(--ink)' : '1px solid var(--hairline)',
              }}
            />
          ))}
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <input style={{ ...s.input, width: 120 }} value={primary} onChange={(e) => setPrimary(e.target.value)} aria-label="Custom hex" />
          <span style={{ padding: '9px 16px', background: primary, color: onAccent, borderRadius: 4, fontWeight: 600, fontSize: 13 }}>
            Book now
          </span>
          <span style={s.meta}>text auto-flips for contrast</span>
          <button style={s.primary} onClick={() => void saveTheme()}>Save theme</button>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '24px 0 10px' }}>
        <h2 style={{ ...s.title, fontSize: 16, margin: 0 }}>Sections</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <select style={s.input} value={addType} onChange={(e) => setAddType(e.target.value as SectionType)}>
            {SECTION_TYPES.map((ty) => <option key={ty} value={ty}>{ty}</option>)}
          </select>
          <button style={s.ghost} onClick={addSection}>Add section</button>
          <button style={s.ghost} onClick={() => void saveDraft()}>Save draft</button>
          <button style={s.primary} onClick={() => void publish()}>Publish</button>
        </div>
      </div>

      {sections.length === 0 && <p style={s.empty}>No sections yet. Add one above.</p>}
      {sections.map((section, i) => (
        <div key={section.id} style={{ ...s.panel, marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <span style={{ fontWeight: 600 }}>
              {section.type}{' '}
              <span style={section.publishedAt ? s.settled : s.waiting}>
                {section.publishedAt ? 'Published' : 'Draft'}
              </span>
            </span>
            <span style={{ display: 'flex', gap: 6 }}>
              <button style={s.ghost} onClick={() => move(section.id, -1)} disabled={i === 0}>↑</button>
              <button style={s.ghost} onClick={() => move(section.id, 1)} disabled={i === sections.length - 1}>↓</button>
              <button style={s.ghost} onClick={() => update(section.id, { enabled: !section.enabled })}>
                {section.enabled ? 'On' : 'Off'}
              </button>
              <button style={s.ghost} onClick={() => remove(section.id)}>Remove</button>
            </span>
          </div>
          {(FIELDS[section.type] ?? ['heading']).map((field) => (
            <div key={field} style={{ marginBottom: 8 }}>
              <label style={s.label}>{field}</label>
              <input
                style={{ ...s.input, width: '100%', boxSizing: 'border-box' }}
                value={section.data[field] ?? ''}
                onChange={(e) => setField(section.id, field, e.target.value)}
                aria-label={`${section.type} ${field}`}
              />
            </div>
          ))}
        </div>
      ))}
    </>
  );
}

function safeReadable(hex: string): string {
  try {
    return readableTextOn(hex);
  } catch {
    return '#ffffff';
  }
}
