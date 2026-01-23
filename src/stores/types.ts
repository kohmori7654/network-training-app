// ネットワークシミュレータ用型定義

// ========== 基本型 ==========

export type DeviceType = 'l2-switch' | 'l3-switch' | 'pc';

export type PortStatus = 'up' | 'down' | 'admin-down';

export type CliMode = 'user' | 'privileged' | 'global-config' | 'interface-config' | 'vlan-config' | 'router-ospf-config' | 'router-bgp-config';

// ========== ポート ==========

export interface Port {
  id: string;
  name: string;           // e.g., "Gi1/0/1", "eth0"
  connectedTo: string | null;  // 接続先ポートID
  status: PortStatus;
  vlan?: number;
  speed?: string;         // e.g., "1000Mbps"
  duplex?: 'full' | 'half' | 'auto';
  mode?: 'access' | 'trunk' | 'dynamic' | 'routed'; // Added 'routed'
  trunkAllowedVlans?: number[]; // undefined means all allowed (1-4094)
  channelGroup?: number;
  // Routed Port fields
  ipAddress?: string;
  subnetMask?: string;
}

export interface EtherChannel {
  id: number;
  protocol: 'lacp' | 'pagp' | 'on';
  status: 'up' | 'down';
}

// ========== ネットワークテーブル ==========

export interface MacEntry {
  macAddress: string;
  vlan: number;
  port: string;
  type: 'dynamic' | 'static';
}

export interface ArpEntry {
  ipAddress: string;
  macAddress: string;
  interface: string;
  age: number;
}

export interface RouteEntry {
  network: string;
  mask: string;
  nextHop: string;
  interface: string;
  metric: number;
  protocol: 'connected' | 'static' | 'ospf' | 'eigrp' | 'bgp';
}

export interface StpState {
  mode: 'pvst' | 'rapid-pvst' | 'mst';
  rootBridgeId?: string;
  priority: number;
  portStates: Record<string, 'forwarding' | 'blocking' | 'learning' | 'listening' | 'disabled'>;
  vlanConfig?: Record<number, { priority: number; rootType?: 'primary' | 'secondary' }>; // Added for PVST
}

export interface HsrpState {
  group: number;
  state: 'init' | 'learn' | 'listen' | 'speak' | 'standby' | 'active';
  priority: number;
  preempt: boolean;
  virtualIp: string;
  helloTimer: number;
  holdTimer: number;
}

export interface VlanInfo {
  id: number;
  name: string;
  status: 'active' | 'suspended';
}

// ========== デバイス定義 ==========

export interface Position {
  x: number;
  y: number;
}

export interface BaseDevice {
  id: string;
  type: DeviceType;
  name: string;
  hostname: string;
  position: Position;
  ports: Port[];
}

export interface L2Switch extends BaseDevice {
  type: 'l2-switch';
  model: 'Catalyst 2960-X';
  vlanDb: VlanInfo[];
  macAddressTable: MacEntry[];
  stpState: StpState;
  runningConfig: string[];
  etherChannels: EtherChannel[];
  ipDefaultGateway?: string; // Added
}

export interface OspfConfig {
  processId: number;
  networks: { network: string; wildcard: string; area: number }[];
  redistribute?: { protocol: 'bgp' | 'static' | 'connected'; asNumber?: number }[];
}

export interface BgpConfig {
  asNumber: number;
  neighbors: { ip: string; remoteAs: number }[];
  networks: { network: string; mask: string }[];
  redistribute?: { protocol: 'ospf' | 'static' | 'connected'; processId?: number }[];
}

export interface L3Switch extends BaseDevice {
  type: 'l3-switch';
  model: 'Catalyst 3750-X';
  vlanDb: VlanInfo[];
  macAddressTable: MacEntry[];
  stpState: StpState;
  routingTable: RouteEntry[];
  arpTable: ArpEntry[];
  hsrpGroups: HsrpState[];
  runningConfig: string[];
  etherChannels: EtherChannel[];
  // Routing Protocols
  ospfConfig?: OspfConfig;
  bgpConfig?: BgpConfig;
}

export interface PC extends BaseDevice {
  type: 'pc';
  ipAddress: string;
  subnetMask: string;
  defaultGateway: string;
  macAddress: string;
}

export type Device = L2Switch | L3Switch | PC;

// ========== 接続 ==========

export interface Connection {
  id: string;
  sourceDeviceId: string;
  sourceHandle?: string; // Added: specific handle ID
  sourcePortId: string;
  targetDeviceId: string;
  targetHandle?: string; // Added: specific handle ID
  targetPortId: string;
  status: 'up' | 'down';
}

// ========== ストア状態 ==========

export interface TerminalState {
  output: string[];
  cliMode: CliMode;
  currentInterface?: string;
  currentVlan?: number;
  selectedPortIds?: string[]; // Added: For interface range selection
  commandHistory: string[];
}

export interface NetworkState {
  devices: Device[];
  connections: Connection[];
  selectedDeviceId: string | null;
  terminalStates: { [deviceId: string]: TerminalState };
}

// ========== アクション ==========

export interface NetworkActions {
  // デバイス操作
  addDevice: (device: Device) => void;
  removeDevice: (deviceId: string) => void;
  updateDevice: (deviceId: string, updates: Partial<Device>) => void;
  updateDevicePosition: (deviceId: string, position: Position) => void;

  // 接続操作
  addConnection: (connection: Connection) => void;
  removeConnection: (connectionId: string) => void;

  // 選択
  selectDevice: (deviceId: string | null) => void;

  // PC設定
  updatePCConfig: (deviceId: string, config: { hostname: string; ipAddress: string; subnetMask: string; defaultGateway: string }) => void;

  // ポート操作
  connectPorts: (sourceDeviceId: string, sourcePortId: string, targetDeviceId: string, targetPortId: string, sourceHandle?: string, targetHandle?: string) => void;
  disconnectPort: (deviceId: string, portId: string) => void;

  // データ永続化
  exportToJson: () => string;
  importFromJson: (json: string) => boolean;
  resetState: () => void;

  // ターミナル状態管理
  updateTerminalState: (deviceId: string, state: Partial<TerminalState>) => void;
  getTerminalState: (deviceId: string) => TerminalState | undefined;
}

export type NetworkStore = NetworkState & NetworkActions;

// ========== ヘルパー関数の型 ==========

export interface DeviceFactory {
  createL2Switch: (id: string, name: string, position: Position) => L2Switch;
  createL3Switch: (id: string, name: string, position: Position) => L3Switch;
  createPC: (id: string, name: string, position: Position) => PC;
}
