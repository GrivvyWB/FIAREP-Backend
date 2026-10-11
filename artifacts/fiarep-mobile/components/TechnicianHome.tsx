// The Technician home — FIAREP's own crew. Dark field-ops look: banner with
// the hard hat and skyline, one big My Jobs card, then colour-coded sections
// of glowing tiles, and a bottom bar. Every tile is the same function the
// plain CPM / Inspector home has; only the look changes.
import React from 'react';
import { View, Text, Pressable, ScrollView, Image, ImageBackground, StyleSheet, useWindowDimensions, Platform } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';

export type TechTile = { key: string; title: string; desc: string; onPress: () => void; badge?: number };
export type TechSection = { heading: string; color: string; glow: string; tiles: TechTile[]; viewAll?: () => void; columns?: number };

const BG = '#070B16';
const HEADER_IMG = require('../assets/tech/tech-header.png');
const JOBS_IMG = require('../assets/tech/tech-jobs.png');

// One icon per tile, keyed by the tile's route key.
function TileIcon({ k, color }: { k: string; color: string }) {
  const s = 26;
  switch (k) {
    case 'projects': return <MaterialCommunityIcons name="clipboard-check-outline" size={s} color={color} />;
    case 'new-project': return <Ionicons name="add" size={32} color={color} />;
    case 'time-off': return <Ionicons name="time-outline" size={s} color={color} />;
    case 'time-clock': return <Ionicons name="stopwatch-outline" size={s} color={color} />;
    case 'scope': return <MaterialCommunityIcons name="bullseye-arrow" size={s} color={color} />;
    case 'change-order': return <MaterialCommunityIcons name="file-document-edit-outline" size={s} color={color} />;
    case 'measure': return <MaterialCommunityIcons name="ruler" size={s} color={color} />;
    case 'saved': return <MaterialCommunityIcons name="database-outline" size={s} color={color} />;
    case 'inbox': return <Ionicons name="mail-outline" size={s} color={color} />;
    case 'lookup': return <MaterialCommunityIcons name="server" size={s} color={color} />;
    case 'translator': return <Ionicons name="globe-outline" size={s} color={color} />;
    case 'signout': return <Ionicons name="log-out-outline" size={s} color={color} />;
    case 'hud': return <MaterialCommunityIcons name="home-search-outline" size={s} color={color} />;
    case 'violations': return <MaterialCommunityIcons name="alert-octagon-outline" size={s} color={color} />;
    case 'vision': return <MaterialCommunityIcons name="eye-outline" size={s} color={color} />;
    case 'routes': return <MaterialCommunityIcons name="map-marker-path" size={s} color={color} />;
    case 'inspections': return <MaterialCommunityIcons name="clipboard-list-outline" size={s} color={color} />;
    case 'report': return <MaterialCommunityIcons name="file-plus-outline" size={s} color={color} />;
    default: return <Ionicons name="ellipse-outline" size={s} color={color} />;
  }
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

function Tile({ t, color, glow, width }: { t: TechTile; color: string; glow: string; width: number }) {
  return (
    <Pressable onPress={t.onPress} style={({ pressed }) => [st.tile, { width, borderColor: color, shadowColor: glow, opacity: pressed ? 0.8 : 1 }]}>
      <LinearGradient colors={[color + '55', '#0B1326EE']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      <View style={{ alignSelf: 'flex-start' }}>
        <Glow color={color} size={width < 110 ? 50 : 58}><TileIcon k={t.key} color="#fff" /></Glow>
        {t.badge ? <View style={st.badge}><Text style={st.badgeText}>{t.badge}</Text></View> : null}
      </View>
      <Text style={[st.tileTitle, width < 110 && { fontSize: 14 }]} numberOfLines={2}>{t.title}</Text>
      <Text style={[st.tileDesc, width < 110 && { fontSize: 10.5 }]} numberOfLines={2}>{t.desc}</Text>
      <View style={{ position: 'absolute', right: 8, bottom: 8 }}><Chevron color={color} size={width < 110 ? 24 : 28} /></View>
    </Pressable>
  );
}

export default function TechnicianHome({ sections, jobCount, onMyJobs, onTimeClock, clockedIn, onSearch, onSettings, tagline = 'Get it done. Keep it running.' }: {
  sections: TechSection[]; jobCount: number; onMyJobs: () => void; onTimeClock: () => void; clockedIn?: boolean; onSearch: () => void; onSettings: () => void; tagline?: string;
}) {
  const { width } = useWindowDimensions();
  const pad = 14; const gap = 10;
  const colW = (n: number) => Math.floor((width - pad * 2 - gap * (n - 1)) / n);

  return (
    <View style={{ flex: 1, backgroundColor: BG }}>
      <ScrollView contentContainerStyle={{ paddingBottom: 96 }} showsVerticalScrollIndicator={false}>
        {/* Banner */}
        <View style={st.banner}>
          <LinearGradient colors={['#0B2E8A', '#0A1E55', '#070B16']} start={{ x: 0, y: 0 }} end={{ x: 0.9, y: 1 }} style={StyleSheet.absoluteFill} />
          <Image source={HEADER_IMG} resizeMode="cover" style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: width * 0.5, opacity: 0.95 }} />
          <LinearGradient colors={['#0B2E8A', '#0B2E8A00']} start={{ x: 0.45, y: 0 }} end={{ x: 0.75, y: 0 }} style={StyleSheet.absoluteFill} />
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: pad, paddingTop: Platform.OS === 'ios' ? 56 : 28, paddingBottom: 22 }}>
            <MaterialCommunityIcons name="account-hard-hat" size={62} color="#3B9BFF" style={{ textShadowColor: '#3B9BFF', textShadowRadius: 14 }} />
            <View style={{ width: 2, height: 56, backgroundColor: '#5EB3FF88', marginHorizontal: 14, borderRadius: 1 }} />
            <View>
              <Text style={st.bannerTitle}>Technician</Text>
              <Text style={st.bannerSub}>{tagline}</Text>
            </View>
          </View>
        </View>

        {/* My Work */}
        <View style={{ paddingHorizontal: pad, marginTop: 16 }}>
          <SectionHead title="MY WORK" color="#3B9BFF" onViewAll={onMyJobs} />
          <Pressable onPress={onMyJobs} style={({ pressed }) => [st.jobsCard, { opacity: pressed ? 0.85 : 1 }]}>
            <LinearGradient colors={['#0E3FA8', '#0A2C7E']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
            <ImageBackground source={JOBS_IMG} resizeMode="cover" style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: '46%' }} imageStyle={{ opacity: 0.85 }}>
              <LinearGradient colors={['#0E3FA8', '#0E3FA800']} start={{ x: 0, y: 0 }} end={{ x: 0.6, y: 0 }} style={StyleSheet.absoluteFill} />
            </ImageBackground>
            <View style={{ flexDirection: 'row', alignItems: 'center', padding: 16 }}>
              <Glow color="#1E6FFF" size={78}><MaterialCommunityIcons name="account-hard-hat" size={38} color="#fff" /></Glow>
              <View style={{ marginLeft: 16, flex: 1 }}>
                <Text style={st.jobsTitle}>My Jobs{jobCount > 0 ? ` (${jobCount})` : ''}</Text>
                <Text style={st.jobsDesc}>View and manage{'\n'}assigned work orders.</Text>
              </View>
              <Chevron color="#3B9BFF" size={44} />
            </View>
          </Pressable>
          {/* Punch clock — always here for FIAREP's own crew. */}
          <Pressable onPress={onTimeClock} style={({ pressed }) => [st.clockCard, { opacity: pressed ? 0.85 : 1 }]}>
            <LinearGradient colors={['#123A8F', '#0B1F55']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
            <Glow color="#1E6FFF" size={50}><Ionicons name="stopwatch-outline" size={26} color="#fff" /></Glow>
            <View style={{ marginLeft: 14, flex: 1 }}>
              <Text style={{ color: '#fff', fontSize: 19, fontWeight: '800' }}>Time Clock</Text>
              <Text style={{ color: '#C9D6EE', fontSize: 13, marginTop: 2 }}>{clockedIn ? 'On the clock — tap to clock out.' : 'Clock in when you arrive, out when you leave.'}</Text>
            </View>
            {clockedIn ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: '#19C37D', marginRight: 10, shadowColor: '#19C37D', shadowOpacity: 1, shadowRadius: 6, shadowOffset: { width: 0, height: 0 } }} /> : null}
            <Chevron color="#3B9BFF" size={36} />
          </Pressable>
        </View>

        {sections.map((sec) => {
          // Four across on a tablet; on a phone three fit, four-tile sections go two by two so nothing truncates.
          const n = sec.columns ?? (width >= 600 ? (sec.tiles.length <= 3 ? 3 : 4) : sec.tiles.length <= 3 ? 3 : 2);
          const w = colW(n);
          return (
            <View key={sec.heading} style={{ paddingHorizontal: pad, marginTop: 18 }}>
              <SectionHead title={sec.heading.toUpperCase()} color={sec.color} onViewAll={sec.viewAll} />
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap }}>
                {sec.tiles.map((t) => <Tile key={t.key} t={t} color={sec.color} glow={sec.glow} width={w} />)}
              </View>
            </View>
          );
        })}
      </ScrollView>

      {/* Bottom bar */}
      <View style={st.tabbar}>
        <Tab icon={<Ionicons name="home" size={24} color="#3B9BFF" />} label="Home" active onPress={() => undefined} />
        <Tab icon={<Ionicons name="clipboard-outline" size={24} color="#9AA4B8" />} label="My Work" onPress={onMyJobs} />
        <Tab icon={<Ionicons name="search" size={24} color="#9AA4B8" />} label="Search" onPress={onSearch} />
        <Tab icon={<Ionicons name="settings-outline" size={24} color="#9AA4B8" />} label="Settings" onPress={onSettings} />
      </View>
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
          <Text style={{ color: color, fontWeight: '600', fontSize: 14 }}>View All</Text>
          <Ionicons name="chevron-forward" size={16} color={color} />
        </Pressable>
      ) : null}
    </View>
  );
}

function Tab({ icon, label, active, onPress }: { icon: React.ReactNode; label: string; active?: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={{ flex: 1, alignItems: 'center', paddingTop: 8 }}>
      {icon}
      <Text style={{ color: active ? '#3B9BFF' : '#9AA4B8', fontSize: 12, fontWeight: active ? '700' : '500', marginTop: 4 }}>{label}</Text>
      {active ? <View style={{ height: 3, width: 48, backgroundColor: '#3B9BFF', borderRadius: 2, marginTop: 6 }} /> : <View style={{ height: 3, marginTop: 6 }} />}
    </Pressable>
  );
}

const st = StyleSheet.create({
  banner: { overflow: 'hidden', backgroundColor: '#0B2E8A' },
  bannerTitle: { color: '#fff', fontSize: 34, fontWeight: '800', letterSpacing: 0.3 },
  bannerSub: { color: '#CFE3FF', fontSize: 15, marginTop: 2 },
  jobsCard: { borderRadius: 18, overflow: 'hidden', borderWidth: 1.5, borderColor: '#3B9BFF', shadowColor: '#1E6FFF', shadowOpacity: 0.7, shadowRadius: 12, shadowOffset: { width: 0, height: 0 }, elevation: 8 },
  clockCard: { marginTop: 10, borderRadius: 16, overflow: 'hidden', borderWidth: 1.5, borderColor: '#3B9BFF', flexDirection: 'row', alignItems: 'center', padding: 12, shadowColor: '#1E6FFF', shadowOpacity: 0.5, shadowRadius: 10, shadowOffset: { width: 0, height: 0 }, elevation: 6 },
  jobsTitle: { color: '#fff', fontSize: 26, fontWeight: '800' },
  jobsDesc: { color: '#C9D6EE', fontSize: 15, marginTop: 4, lineHeight: 20 },
  tile: { borderRadius: 16, overflow: 'hidden', borderWidth: 1.5, padding: 10, paddingBottom: 38, minHeight: 150, backgroundColor: '#0B1326', shadowOpacity: 0.55, shadowRadius: 10, shadowOffset: { width: 0, height: 0 }, elevation: 5 },
  tileTitle: { color: '#fff', fontWeight: '800', fontSize: 16, marginTop: 10 },
  tileDesc: { color: '#B9C3D6', fontSize: 11.5, marginTop: 4, lineHeight: 15 },
  badge: { position: 'absolute', top: -4, right: -6, minWidth: 20, height: 20, borderRadius: 10, backgroundColor: '#FF4D4D', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '800' },
  tabbar: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', backgroundColor: '#070B16F2', borderTopWidth: 1, borderTopColor: '#1C2740', paddingBottom: Platform.OS === 'ios' ? 22 : 8 },
});
