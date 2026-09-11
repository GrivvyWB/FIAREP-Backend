import { StyleSheet } from 'react-native';
export const money = (x: number) =>
  '$' + x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const ACCENT = '#185FA5';
export const ui = StyleSheet.create({
  wrap: { padding: 16, gap: 12 },
  h: { fontSize: 16, fontWeight: '500', marginTop: 8 },
  row: { flexDirection: 'row', gap: 12 },
  label: { fontSize: 12, color: '#666', marginBottom: 4 },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 10, fontSize: 16, backgroundColor: '#fff' },
  btn: { backgroundColor: ACCENT, padding: 14, borderRadius: 10, alignItems: 'center' },
  btnMuted: { backgroundColor: '#999' },
  btnText: { color: '#fff', fontWeight: '500', fontSize: 15 },
  btnOutline: { borderWidth: 1, borderColor: ACCENT, padding: 12, borderRadius: 10, alignItems: 'center' },
  btnOutlineText: { color: ACCENT, fontWeight: '500' },
  card: { borderWidth: 1, borderColor: '#e0e0e0', borderRadius: 12, padding: 16, backgroundColor: '#fff' },
  cardTitle: { fontSize: 16, fontWeight: '500', marginBottom: 10 },
  line: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
  lineK: { color: '#666' }, lineV: { fontWeight: '500' },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingTop: 10 },
  totalK: { fontWeight: '500', fontSize: 16 }, totalV: { fontWeight: '500', fontSize: 16, color: ACCENT },
  listItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: 16, borderWidth: 1, borderColor: '#e0e0e0', borderRadius: 12, backgroundColor: '#fff' },
  listTitle: { fontSize: 16, fontWeight: '500' },
  listSub: { fontSize: 13, color: '#666', marginTop: 2 },
  empty: { color: '#999', textAlign: 'center', marginTop: 40 },
});
