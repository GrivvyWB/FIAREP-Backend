export type ElevComponent = { id: string; label: string; note?: string };
export type ElevSection = { id: string; title: string; icon: string; components: ElevComponent[] };

export const ELEVATOR_SECTIONS: ElevSection[] = [
  { id: 'core', title: 'Core Mechanical System', icon: '⚙️', components: [
    { id: 'hoist-motor', label: 'Hoist Motor', note: 'geared/gearless machines that lift the car' },
    { id: 'traction-sheave', label: 'Traction Sheave', note: 'transfers motor torque to ropes' },
    { id: 'hoist-ropes', label: 'Hoist Ropes / Belts', note: 'steel ropes or flat belts' },
    { id: 'brake-assembly', label: 'Brake Assembly', note: 'electromagnetic brake holding car at rest' },
    { id: 'governor', label: 'Governor System', note: 'overspeed detection + tension pulley' },
    { id: 'safety-gear', label: 'Safety Gear', note: 'clamps onto guide rails during overspeed' },
    { id: 'guide-rails', label: 'Guide Rails', note: 'vertical tracks for car & counterweight' },
    { id: 'guide-shoes', label: 'Guide Shoes / Rollers', note: 'sliding or roller assemblies; high-wear' },
    { id: 'counterweight', label: 'Counterweight Assembly', note: 'balances car load' },
    { id: 'buffers', label: 'Buffers', note: 'hydraulic or spring shock absorbers at pit' },
  ]},
  { id: 'drive', title: 'Drive & Control Subsystems', icon: '🎛️', components: [
    { id: 'controller', label: 'Controller', note: 'main logic brain' },
    { id: 'drive-inverter', label: 'Drive / Inverter', note: 'VVVF motor control' },
    { id: 'encoders', label: 'Encoders', note: 'position feedback on motor/governor' },
    { id: 'pcb-boards', label: 'PCB Boards', note: 'control boards for drive, door operator, COP/LOP' },
    { id: 'relays', label: 'Relays & Contactors', note: 'essential switching components' },
    { id: 'transformers', label: 'Transformers & Power Supplies' },
    { id: 'wiring-harness', label: 'Wiring Harnesses', note: 'safety-circuit wiring prone to aging' },
  ]},
  { id: 'doors', title: 'Door System Components', icon: '🚪', components: [
    { id: 'door-operator', label: 'Door Operator', note: 'motor + linkage' },
    { id: 'door-motor', label: 'Door Motor', note: 'VVVF motors' },
    { id: 'door-rollers', label: 'Door Hanger Rollers', note: 'high-wear' },
    { id: 'door-sliders', label: 'Door Sliders' },
    { id: 'door-vanes', label: 'Door Vanes / Door Knives' },
    { id: 'door-lock-contacts', label: 'Door Lock Contacts', note: 'frequent failure point' },
    { id: 'door-interlocks', label: 'Door Interlocks' },
    { id: 'door-belts', label: 'Door Belts', note: 'operator belts' },
    { id: 'light-curtains', label: 'Light Curtains', note: 'photoelectric safety edges; high-consumption' },
  ]},
  { id: 'safety', title: 'Safety & Sensing Components', icon: '🛡️', components: [
    { id: 'limit-switches', label: 'Limit Switches' },
    { id: 'door-zone-sensors', label: 'Door Zone Sensors', note: 'prone to aging' },
    { id: 'load-weighing', label: 'Load Weighing Sensors' },
    { id: 'overload-switches', label: 'Overload Switches' },
    { id: 'safety-contacts', label: 'Safety Contacts' },
    { id: 'mag-leveling', label: 'Magnetic Leveling Sensors' },
    { id: 'photoelectric', label: 'Photoelectric Sensors' },
  ]},
  { id: 'car-ui', title: 'Car Interior & User Interface', icon: '🛗', components: [
    { id: 'cop-buttons', label: 'COP Buttons', note: 'high-failure in high-traffic buildings' },
    { id: 'lop-buttons', label: 'LOP Hall Call Buttons' },
    { id: 'indicator-boards', label: 'Indicator Boards' },
    { id: 'display-panels', label: 'Display Panels' },
    { id: 'car-fans', label: 'Car Fans' },
    { id: 'lighting-fixtures', label: 'Lighting Fixtures' },
  ]},
  { id: 'hydraulic', title: 'Hydraulic Elevator Components', icon: '💧', components: [
    { id: 'hyd-pump', label: 'Hydraulic Pump Unit' },
    { id: 'hyd-cylinder', label: 'Hydraulic Cylinder' },
    { id: 'valve-assembly', label: 'Valve Assembly' },
    { id: 'rupture-valve', label: 'Rupture Valve' },
    { id: 'oil-tank', label: 'Oil Tank & Filters' },
  ]},
  { id: 'accessories', title: 'Accessories & Support Hardware', icon: '🧰', components: [
    { id: 'bearings', label: 'Bearings', note: 'traction machine, rollers, door systems' },
    { id: 'bushings', label: 'Bushings & Sleeves' },
    { id: 'springs', label: 'Springs', note: 'door closing, governor tension' },
    { id: 'gibs', label: 'Gibs & Guides' },
    { id: 'fasteners', label: 'Fasteners & Anchors' },
    { id: 'coils', label: 'Coils', note: 'brake coils, relay coils' },
    { id: 'capacitors', label: 'Capacitors & Rectifiers' },
    { id: 'lamps', label: 'Miniature Lamps / Bulbs' },
  ]},
  { id: 'high-freq', title: 'High-Frequency Repair & Replacement Items', icon: '🔧', components: [
    { id: 'hf-door-rollers', label: 'Door rollers' },
    { id: 'hf-door-sliders', label: 'Door sliders' },
    { id: 'hf-lock-contacts', label: 'Door lock contacts' },
    { id: 'hf-light-curtains', label: 'Light curtains' },
    { id: 'hf-push-buttons', label: 'Push buttons' },
    { id: 'hf-indicator-lamps', label: 'Indicator lamp boards' },
    { id: 'hf-micro-switches', label: 'Micro-switches' },
    { id: 'hf-relays', label: 'Relays & contactors' },
    { id: 'hf-guide-shoe-liners', label: 'Guide shoe liners' },
    { id: 'hf-safety-connectors', label: 'Safety circuit connectors' },
    { id: 'hf-door-belts', label: 'Door belts' },
    { id: 'hf-fans', label: 'Temperature-controlled fans' },
    { id: 'hf-small-pcb', label: 'Small PCB boards' },
  ]},
  { id: 'modernization', title: 'Optional Modernization Accessories', icon: '🧩', components: [
    { id: 'mod-rescue', label: 'Emergency Auto-Rescue Units' },
    { id: 'mod-ups', label: 'UPS Backup Modules' },
    { id: 'mod-access', label: 'Access Control Systems' },
    { id: 'mod-cctv', label: 'CCTV Modules' },
    { id: 'mod-regen', label: 'Energy-saving regenerative drives' },
  ]},
];

export type ElevRecord = { condition?: 'Good' | 'Repair' | 'Replace' | 'N/A'; cost?: string; note?: string };
export type ElevatorState = { header: { elevatorId?: string; type?: string; location?: string; date?: string }; items: Record<string, ElevRecord>; photos?: string[]; };
export const EMPTY_ELEVATOR: ElevatorState = { header: {}, items: {} };
export const ELEV_CONDITIONS: Array<'Good' | 'Repair' | 'Replace' | 'N/A'> = ['Good', 'Repair', 'Replace', 'N/A'];
