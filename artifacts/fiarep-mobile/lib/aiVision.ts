export type ViolationClassification = {
  classification: 'A' | 'B' | 'C';
  confidence: number;      // 0-100
  condition: string;       // detected condition
  hpCode: string;          // suggested HPD code or "REVIEW REQUIRED"
  trade: string;           // recommended trade
  priority: 'Low' | 'Medium' | 'High';
  description: string;     // explanation
};

export async function classifyViolationPhoto(base64DataUrl: string): Promise<ViolationClassification> {
  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  if (!domain) {
    throw new Error('The FIAREP backend domain is not configured.');
  }
  const res = await fetch(`https://${domain}/api/ai/classify-violation`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ image: base64DataUrl }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error('AI request failed (' + res.status + '). ' + t.slice(0, 200));
  }
  const parsed = await res.json();
  const cls = (parsed.classification || 'B').toString().toUpperCase();
  return {
    classification: (cls === 'A' || cls === 'B' || cls === 'C') ? cls : 'B',
    confidence: Number.isFinite(+parsed.confidence) ? Math.max(0, Math.min(100, Math.round(+parsed.confidence))) : 0,
    condition: String(parsed.condition || 'Unspecified condition'),
    hpCode: String(parsed.hpCode || 'REVIEW REQUIRED'),
    trade: String(parsed.trade || 'General'),
    priority: (['Low','Medium','High'].includes(parsed.priority) ? parsed.priority : 'Medium'),
    description: String(parsed.description || ''),
  };
}
