/**
 * Stage 0 placeholder. Per-tenant sites, the section CMS and online booking
 * land in Stage 6 / Stage 4 respectively.
 */
export default function Page() {
  return (
    <main style={{ padding: '48px 24px', fontFamily: 'system-ui, sans-serif', maxWidth: 640 }}>
      <h1 style={{ fontSize: 26, fontWeight: 600, margin: '0 0 10px', letterSpacing: '-0.02em' }}>
        Stage 0
      </h1>
      <p style={{ fontSize: 14, lineHeight: 1.6, color: '#5A626B', margin: 0 }}>
        Public site host. Tenant resolution from the request host, the section CMS and online
        booking arrive in later stages.
      </p>
    </main>
  );
}
