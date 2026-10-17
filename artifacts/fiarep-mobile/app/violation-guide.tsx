// Take me there: step-by-step guidance to where an HPD inspector wrote a
// violation - the floor, the apartment, the room and the surface - with a live
// compass arrow for every step HPD describes by direction.
import { useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { ui, ACCENT } from '../lib/ui';
import { guideFor } from '../lib/violation-guide';

let Location: any = null;
try { Location = require('expo-location'); } catch (e) { Location = null; }

/** Live compass heading (degrees from north), or null when the phone can't tell. */
function useHeading(): number | null {
  const [heading, setHeading] = useState<number | null>(null);
  useEffect(() => {
    let sub: { remove: () => void } | null = null;
    let alive = true;
    (async () => {
      try {
        if (!Location?.watchHeadingAsync) return;
        const perm = await Location.getForegroundPermissionsAsync();
        if (!perm.granted) await Location.requestForegroundPermissionsAsync();
        sub = await Location.watchHeadingAsync((h: { trueHeading: number; magHeading: number }) => {
          if (!alive) return;
          const v = h.trueHeading >= 0 ? h.trueHeading : h.magHeading;
          if (Number.isFinite(v)) setHeading(v);
        });
      } catch { /* no compass */ }
    })();
    return () => { alive = false; sub?.remove(); };
  }, []);
  return heading;
}

export default function ViolationGuide() {
  const p = useLocalSearchParams<{ description?: string; apartment?: string; story?: string; cls?: string; id?: string; address?: string }>();
  const description = String(p.description || '');
  const guide = useMemo(() => guideFor({ description, apartment: String(p.apartment || ''), story: String(p.story || '') }), [description, p.apartment, p.story]);
  const [i, setI] = useState(0);
  const heading = useHeading();
  const step = guide.steps[i];
  const last = i >= guide.steps.length - 1;

  // How far to turn: the arrow points where to face, relative to where the phone points now.
  const turn = step?.bearing != null && heading != null ? ((step.bearing - heading + 540) % 360) - 180 : null;
  const onTarget = turn != null && Math.abs(turn) <= 20;

  return (
    <ScrollView contentContainerStyle={[ui.wrap, { paddingTop: 16 }]}>
      <Text style={{ fontSize: 22, fontWeight: '800' }}>Take me there</Text>
      <Text style={ui.listSub}>{['HPD', p.cls ? `Class ${p.cls}` : '', p.id ? `#${p.id}` : '', p.address || ''].filter(Boolean).join(' · ')}</Text>

      {!guide.found || guide.steps.length === 0 ? (
        <View style={[ui.card, { gap: 6 }]}>
          <Text style={{ fontWeight: '700' }}>No location in this violation</Text>
          <Text style={ui.listSub}>HPD did not write where in the apartment it is. Here is the inspector's wording:</Text>
        </View>
      ) : (
        <View style={[ui.card, { gap: 12, alignItems: 'center' }]}>
          <Text style={[ui.listSub, { alignSelf: 'flex-start' }]}>Step {i + 1} of {guide.steps.length}</Text>
          <Text style={{ fontSize: 20, fontWeight: '800', textAlign: 'center' }}>{step.title}</Text>
          {step.bearing != null && (
            <View style={{ alignItems: 'center', gap: 6 }}>
              {heading == null ? (
                <Text style={ui.listSub}>Reading the compass… hold the phone flat.</Text>
              ) : (
                <>
                  <View style={{ width: 150, height: 150, borderRadius: 75, borderWidth: 3, borderColor: onTarget ? '#16a34a' : '#cbd5e1', alignItems: 'center', justifyContent: 'center', backgroundColor: onTarget ? '#dcfce7' : '#f8fafc' }}>
                    <Text style={{ fontSize: 84, color: onTarget ? '#16a34a' : ACCENT, transform: [{ rotate: `${turn ?? 0}deg` }] }}>↑</Text>
                  </View>
                  <Text style={{ fontWeight: '700', color: onTarget ? '#16a34a' : '#334155' }}>
                    {onTarget ? `You are facing ${step.facing}` : `Turn ${turn! > 0 ? 'right' : 'left'} toward ${step.facing}`}
                  </Text>
                </>
              )}
            </View>
          )}
          <Text style={{ fontSize: 15, textAlign: 'center', color: '#334155' }}>{step.detail}</Text>
          <View style={{ flexDirection: 'row', gap: 10, alignSelf: 'stretch' }}>
            <Pressable style={[ui.btnOutline, { flex: 1 }, i === 0 && { opacity: 0.4 }]} disabled={i === 0} onPress={() => setI(i - 1)}><Text style={ui.btnOutlineText}>Back</Text></Pressable>
            <Pressable style={[ui.btn, { flex: 1 }, last && { opacity: 0.4 }]} disabled={last} onPress={() => setI(i + 1)}><Text style={ui.btnText}>{last ? "You're there" : 'Next'}</Text></Pressable>
          </View>
        </View>
      )}

      <View style={[ui.card, { gap: 4 }]}>
        <Text style={{ fontWeight: '700' }}>What the inspector wrote</Text>
        <Text style={{ fontSize: 14 }}>{description || '—'}</Text>
        {!!(p.apartment || p.story) && <Text style={ui.listSub}>{[p.apartment ? `Apt ${p.apartment}` : '', p.story ? `Story ${p.story}` : ''].filter(Boolean).join(' · ')}</Text>}
      </View>
    </ScrollView>
  );
}
