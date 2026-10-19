// The staff home look — one component for every role (CPM, Inspector, trades,
// supervisors, management, administrator, FIAREP technicians). Banner with the
// role's icon, title and tagline over the skyline; an optional hero card (My
// Jobs); an optional punch-clock card; colour-coded sections of glowing tiles;
// a bottom bar with only the tabs that role uses. Each screen decides WHICH
// tiles appear (same gates as before) — this only draws them.
import React from 'react';
import { View, Text, Pressable, ScrollView, Image, ImageBackground, StyleSheet, useWindowDimensions, Platform } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { cleanLabel, iconFor, sectionColor, taglineFor, tileArt } from '../lib/home-catalog';

export type HomeTile = { label: string; onPress: () => void; badge?: number };
export type HomeSection = { heading: string; tiles: HomeTile[]; viewAll?: () => void; color?: string };
export type HomeTab = { label: string; icon: string; onPress: () => void };

const BG = '#070B16';
const HEADER_IMG = require('../assets/tech/tech-header.png');
const JOBS_IMG = require('../assets/tech/tech-jobs.png');

function Icon({ lib, name, size, color }: { lib: 'ion' | 'mci'; name: string; size: number; color: string }) {
  return lib === 'ion'
    ? <Ionicons name={name as never} size={size} color={color} />
    : <MaterialCommunityIcons name={name as never} size={size} color={color} />;
}

function Glow({ color, size = 58, children }: { color: string; size?: number; children: React.ReactNode }) {
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: color + '33', borderWidth: 1.5, borderColor: color, shadowColor: color, shadowOpacity: 0.9, shadowRadius: 10, shadowOffset: { width: 0, height: 0 }, elevation: 6 }}>
      <View style={{ width: size - 10, height: size - 10, borderRadius: (size - 10) / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: color }}>
        {children}
      </View>
    </View>
  );
}

function Chevron({ color, size = 30 }: { color: string; size?: number }) {
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: '#0B1326', borderWidth: 1.5, borderColor: color, alignItems: 'center', justifyContent: 'center' }}>
      <Ionicons name="chevron-forward" size={size * 0.55} color="#fff" />
    </View>
  );
}

function Tile({ t, color, width }: { t: HomeTile; color: string; width: number }) {
  const { label, badge } = cleanLabel(t.label);
  const art = tileArt(label);
  const n = t.badge ?? badge;
  const small = width < 110;
  return (
    <Pressable onPress={t.onPress} style={({ pressed }) => [st.tile, { width, borderColor: color, shadowColor: color, opacity: pressed ? 0.8 : 1 }]}>
      <LinearGradient colors={[color + '55', '#0B1326EE']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      <View style={{ alignSelf: 'flex-start' }}>
        <Glow color={color} size={small ? 50 : 58}><Icon lib={art.lib} name={art.icon} size={art.icon === 'add' ? 32 : 26} color="#fff" /></Glow>
        {n > 0 ? <View style={st.badge}><Text style={st.badgeText}>{n}</Text></View> : null}
      </View>
      <Text style={[st.tileTitle, small && { fontSize: 13, lineHeight: 16 }]} numberOfLines={small ? 3 : 2}>{label}</Text>
      {art.desc ? <Text style={[st.tileDesc, small && { fontSize: 10.5 }]} numberOfLines={2}>{art.desc}</Text> : null}
      <View style={{ position: 'absolute', right: 8, bottom: 8 }}><Chevron color={color} size={small ? 24 : 28} /></View>
    </Pressable>
  );
}

export default function FieldHome({ title, tagline, icon, hero, clock, sections, tabs = [], banner, topGap = true }: {
  title: string;
  tagline?: string;
  icon?: string;
  /** The big card under MY WORK (My Jobs). */
  hero?: { label: string; desc?: string; onPress: () => void; badge?: number };
  /** The punch clock card. */
  clock?: { onPress: () => void; clockedIn?: boolean; label?: string };
  sections: HomeSection[];
  /** Bottom bar after Home — only the ones this role uses. */
  tabs?: HomeTab[];
  /** Alert / read-only banners drawn under the header. */
  banner?: React.ReactNode;
  topGap?: boolean;
}) {
  const { width } = useWindowDimensions();
  const pad = 14; const gap = 10;
  const colW = (n: number) => Math.floor((width - pad * 2 - gap * (n - 1)) / n);
  const heroColor = '#3B9BFF';
  const bannerIcon = icon || iconFor(title);
  const sub = tagline ?? taglineFor(title);
  const live = sections.filter((s) => s.tiles.length > 0);

  return (
    <View style={{ flex: 1, backgroundColor: BG }}>
      <ScrollView contentContainerStyle={{ paddingBottom: tabs.length ? 96 : 32 }} showsVerticalScrollIndicator={false}>
        <View style={st.banner}>
          <LinearGradient colors={['#06204F', '#03102A', '#03101F']} start={{ x: 0, y: 0 }} end={{ x: 0.9, y: 1 }} style={StyleSheet.absoluteFill} />
          <Image source={HEADER_IMG} resizeMode="cover" style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: width * 0.55, opacity: 1 }} />
          <LinearGradient colors={['#03102A', '#03102A00']} start={{ x: 0.45, y: 0 }} end={{ x: 0.56, y: 0 }} style={StyleSheet.absoluteFill} />
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: pad, paddingTop: topGap ? (Platform.OS === 'ios' ? 56 : 28) : 18, paddingBottom: 22 }}>
            <MaterialCommunityIcons name={bannerIcon as never} size={60} color="#3B9BFF" style={{ textShadowColor: '#3B9BFF', textShadowRadius: 14 }} />
            <View style={{ width: 2, height: 56, backgroundColor: '#5EB3FF88', marginHorizontal: 14, borderRadius: 1 }} />
            <View style={{ flex: 1 }}>
              <Text style={[st.bannerTitle, title.length > 14 && { fontSize: 26 }]} numberOfLines={2}>{title}</Text>
              <Text style={st.bannerSub}>{sub}</Text>
            </View>
          </View>
        </View>

        {banner ? <View style={{ paddingHorizontal: pad, paddingTop: 10 }}>{banner}</View> : null}

        {(hero || clock) && (
          <View style={{ paddingHorizontal: pad, marginTop: 16 }}>
            <SectionHead title="MY WORK" color={heroColor} onViewAll={hero?.onPress} />
            {hero && (
              <Pressable onPress={hero.onPress} style={({ pressed }) => [st.jobsCard, { opacity: pressed ? 0.85 : 1 }]}>
                <LinearGradient colors={['#163B8A', '#0E2A68']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
                <Image source={JOBS_IMG} resizeMode="cover" style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: '60%', height: '100%', opacity: 1 }} />
                <LinearGradient colors={['#123274', '#12327400']} start={{ x: 0.38, y: 0 }} end={{ x: 0.58, y: 0 }} style={StyleSheet.absoluteFill} />
                <View style={{ flexDirection: 'row', alignItems: 'center', padding: 16 }}>
                  <Glow color="#1E6FFF" size={78}><Icon lib={tileArt(hero.label).lib} name={tileArt(hero.label).icon} size={38} color="#fff" /></Glow>
                  <View style={{ marginLeft: 16, flex: 1 }}>
                    <Text style={st.jobsTitle}>{cleanLabel(hero.label).label}{hero.badge ? ` (${hero.badge})` : ''}</Text>
                    <Text style={st.jobsDesc}>{hero.desc ?? tileArt(hero.label).desc}</Text>
                  </View>
                  <Chevron color={heroColor} size={44} />
                </View>
              </Pressable>
            )}
            {clock && (
              <Pressable onPress={clock.onPress} style={({ pressed }) => [st.clockCard, { marginTop: hero ? 10 : 0, opacity: pressed ? 0.85 : 1 }]}>
                <LinearGradient colors={['#123A8F', '#0B1F55']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
                <Glow color="#1E6FFF" size={50}><Ionicons name="stopwatch-outline" size={26} color="#fff" /></Glow>
                <View style={{ marginLeft: 14, flex: 1 }}>
                  <Text style={{ color: '#fff', fontSize: 19, fontWeight: '800' }}>{clock.label ?? 'Time Clock'}</Text>
                  <Text style={{ color: '#C9D6EE', fontSize: 13, marginTop: 2 }}>{clock.clockedIn ? 'On the clock — tap to clock out.' : 'Clock in when you arrive, out when you leave.'}</Text>
                </View>
                {clock.clockedIn ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: '#19C37D', marginRight: 10, shadowColor: '#19C37D', shadowOpacity: 1, shadowRadius: 6, shadowOffset: { width: 0, height: 0 } }} /> : null}
                <Chevron color={heroColor} size={36} />
              </Pressable>
            )}
          </View>
        )}

        {live.map((sec) => {
          const color = sec.color || sectionColor(sec.heading);
          // Four across on a tablet; on a phone three fit, bigger sections go two by two so nothing truncates.
          const n = width >= 600 ? (sec.tiles.length <= 3 ? 3 : 4) : sec.tiles.length <= 2 ? 2 : sec.tiles.length === 3 ? 3 : 2;
          const w = colW(n);
          return (
            <View key={sec.heading} style={{ paddingHorizontal: pad, marginTop: 18 }}>
              <SectionHead title={sec.heading.toUpperCase()} color={color} onViewAll={sec.viewAll} />
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap }}>
                {sec.tiles.map((t, i) => <Tile key={`${t.label}-${i}`} t={t} color={color} width={w} />)}
              </View>
            </View>
          );
        })}
      </ScrollView>

      {tabs.length > 0 && (
        <View style={st.tabbar}>
          <Tab icon="home" label="Home" active onPress={() => undefined} />
          {tabs.slice(0, 3).map((t) => <Tab key={t.label} icon={t.icon} label={t.label} onPress={t.onPress} />)}
        </View>
      )}
    </View>
  );
}

function SectionHead({ title, color, onViewAll }: { title: string; color: string; onViewAll?: () => void }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
      <View style={{ width: 6, height: 22, borderRadius: 3, backgroundColor: color, marginRight: 10, shadowColor: color, shadowOpacity: 0.9, shadowRadius: 6, shadowOffset: { width: 0, height: 0 } }} />
      <Text style={{ color: '#fff', fontWeight: '800', fontSize: 18, letterSpacing: 0.5, flex: 1 }}>{title}</Text>
      {onViewAll ? (
        <Pressable onPress={onViewAll} style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Text style={{ color, fontWeight: '600', fontSize: 14 }}>View All</Text>
          <Ionicons name="chevron-forward" size={16} color={color} />
        </Pressable>
      ) : null}
    </View>
  );
}

function Tab({ icon, label, active, onPress }: { icon: string; label: string; active?: boolean; onPress: () => void }) {
  const color = active ? '#3B9BFF' : '#9AA4B8';
  return (
    <Pressable onPress={onPress} style={{ flex: 1, alignItems: 'center', paddingTop: 8 }}>
      <Ionicons name={icon as never} size={24} color={color} />
      <Text style={{ color, fontSize: 12, fontWeight: active ? '700' : '500', marginTop: 4 }}>{label}</Text>
      <View style={{ height: 3, width: 48, backgroundColor: active ? '#3B9BFF' : 'transparent', borderRadius: 2, marginTop: 6 }} />
    </Pressable>
  );
}

const st = StyleSheet.create({
  banner: { overflow: 'hidden', backgroundColor: '#03102A' },
  bannerTitle: { color: '#fff', fontSize: 34, fontWeight: '800', letterSpacing: 0.3 },
  bannerSub: { color: '#CFE3FF', fontSize: 15, marginTop: 2 },
  jobsCard: { borderRadius: 18, overflow: 'hidden', borderWidth: 1.5, borderColor: '#3B9BFF', shadowColor: '#1E6FFF', shadowOpacity: 0.7, shadowRadius: 12, shadowOffset: { width: 0, height: 0 }, elevation: 8 },
  clockCard: { borderRadius: 16, overflow: 'hidden', borderWidth: 1.5, borderColor: '#3B9BFF', flexDirection: 'row', alignItems: 'center', padding: 12, shadowColor: '#1E6FFF', shadowOpacity: 0.5, shadowRadius: 10, shadowOffset: { width: 0, height: 0 }, elevation: 6 },
  jobsTitle: { color: '#fff', fontSize: 26, fontWeight: '800' },
  jobsDesc: { color: '#C9D6EE', fontSize: 15, marginTop: 4, lineHeight: 20 },
  tile: { borderRadius: 16, overflow: 'hidden', borderWidth: 1.5, padding: 10, paddingBottom: 38, minHeight: 150, backgroundColor: '#0B1326', shadowOpacity: 0.55, shadowRadius: 10, shadowOffset: { width: 0, height: 0 }, elevation: 5 },
  tileTitle: { color: '#fff', fontWeight: '800', fontSize: 16, marginTop: 10 },
  tileDesc: { color: '#B9C3D6', fontSize: 11.5, marginTop: 4, lineHeight: 15 },
  badge: { position: 'absolute', top: -4, right: -6, minWidth: 20, height: 20, borderRadius: 10, backgroundColor: '#FF4D4D', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '800' },
  tabbar: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', backgroundColor: '#070B16F2', borderTopWidth: 1, borderTopColor: '#1C2740', paddingBottom: Platform.OS === 'ios' ? 22 : 8 },
});
