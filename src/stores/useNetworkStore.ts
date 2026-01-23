import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
    NetworkStore,
    Device,
    L2Switch,
    L3Switch,
    PC,
    Connection,
    Position,
    Port,
} from './types';

// ========== ヘルパー関数 ==========

const generateId = () => crypto.randomUUID();

const generateMacAddress = () => {
    const hex = () => Math.floor(Math.random() * 256).toString(16).padStart(2, '0');
    return `${hex()}:${hex()}:${hex()}:${hex()}:${hex()}:${hex()}`.toUpperCase();
};

// L2スイッチのポート生成（Gi1/0/1 ~ Gi1/0/24）
const createL2SwitchPorts = (): Port[] => {
    return Array.from({ length: 24 }, (_, i) => ({
        id: generateId(),
        name: `Gi1/0/${i + 1}`,
        connectedTo: null,
        status: 'up' as const,
        vlan: 1,
    }));
};

// L3スイッチのポート生成（Gi1/0/1 ~ Gi1/0/24）
const createL3SwitchPorts = (): Port[] => {
    return Array.from({ length: 24 }, (_, i) => ({
        id: generateId(),
        name: `Gi1/0/${i + 1}`,
        connectedTo: null,
        status: 'up' as const,
        vlan: 1,
    }));
};

// PCのポート生成（eth0のみ）
const createPCPorts = (): Port[] => {
    return [{
        id: generateId(),
        name: 'eth0',
        connectedTo: null,
        status: 'up' as const,
    }];
};

// ========== デバイス生成関数 ==========

export const createL2Switch = (name: string, position: Position): L2Switch => ({
    id: generateId(),
    type: 'l2-switch',
    name,
    hostname: name,
    model: 'Catalyst 2960-X',
    position,
    ports: createL2SwitchPorts(),
    vlanDb: [{ id: 1, name: 'default', status: 'active' }],
    macAddressTable: [],
    stpState: {
        mode: 'rapid-pvst',
        priority: 32768,
        portStates: {},
    },
    runningConfig: [
        '!',
        `hostname ${name}`,
        '!',
        'spanning-tree mode rapid-pvst',
        '!',
    ],
    etherChannels: [],
});

export const createL3Switch = (name: string, position: Position): L3Switch => ({
    id: generateId(),
    type: 'l3-switch',
    name,
    hostname: name,
    model: 'Catalyst 3750-X',
    position,
    ports: createL3SwitchPorts(),
    vlanDb: [{ id: 1, name: 'default', status: 'active' }],
    macAddressTable: [],
    stpState: {
        mode: 'rapid-pvst',
        priority: 32768,
        portStates: {},
    },
    routingTable: [],
    arpTable: [],
    hsrpGroups: [],
    runningConfig: [
        '!',
        `hostname ${name}`,
        '!',
        'ip routing',
        '!',
    ],
    etherChannels: [],
});

export const createPC = (name: string, position: Position): PC => ({
    id: generateId(),
    type: 'pc',
    name,
    hostname: name,
    position,
    ports: createPCPorts(),
    ipAddress: '',
    subnetMask: '255.255.255.0',
    defaultGateway: '',
    macAddress: generateMacAddress(),
});

// ========== 初期状態 ==========

const initialState = {
    devices: [
        // Distribution Layer (L3 Switches)
        createL3Switch('Dist-SW1', { x: 300, y: 100 }),
        createL3Switch('Dist-SW2', { x: 500, y: 100 }),

        // Access Layer (L2 Switches)
        createL2Switch('Access-SW1', { x: 300, y: 300 }),
        createL2Switch('Access-SW2', { x: 500, y: 300 }),

        // End Devices (PCs)
        createPC('PC1', { x: 200, y: 400 }),
        createPC('PC2', { x: 600, y: 400 }),
    ] as Device[],
    connections: [] as Connection[],
    selectedDeviceId: null as string | null,
    terminalStates: {} as { [deviceId: string]: import('./types').TerminalState },
};

// Initialize connections and specific configs after creation (Helper to build the scenario)
const buildScenario = (state: typeof initialState) => {
    const [dsw1, dsw2, asw1, asw2, pc1, pc2] = state.devices as [L3Switch, L3Switch, L2Switch, L2Switch, PC, PC];

    // --- Connections ---

    // 1. EtherChannel between Dist-SW1 and Dist-SW2 (Gi1/0/23, Gi1/0/24)
    // Using manual connection object creation for simplicity in this init block
    const conns: Connection[] = [];
    const addConn = (d1: Device, p1Name: string, d2: Device, p2Name: string) => {
        const p1 = d1.ports.find(p => p.name === p1Name)!;
        const p2 = d2.ports.find(p => p.name === p2Name)!;
        p1.connectedTo = p2.id;
        p2.connectedTo = p1.id;
        conns.push({
            id: generateId(),
            sourceDeviceId: d1.id,
            sourcePortId: p1.id,
            targetDeviceId: d2.id,
            targetPortId: p2.id,
            status: 'up',
        });
    };

    addConn(dsw1, 'Gi1/0/23', dsw2, 'Gi1/0/23');
    addConn(dsw1, 'Gi1/0/24', dsw2, 'Gi1/0/24');

    // 2. Trunk Uplinks
    addConn(dsw1, 'Gi1/0/1', asw1, 'Gi1/0/1'); // DSW1 -> ASW1
    addConn(dsw2, 'Gi1/0/1', asw2, 'Gi1/0/1'); // DSW2 -> ASW2
    addConn(dsw1, 'Gi1/0/2', asw2, 'Gi1/0/1'); // DSW1 -> ASW2 (Redundant) -> wait, port conflcit on ASW2
    // Let's refine logical topology: DSW1-ASW1, DSW2-ASW2, plus cross-links?
    // For simplicity:
    // DSW1 ==(Po1)== DSW2
    //  |              |
    // ASW1           ASW2
    //  |              |
    // PC1            PC2

    // Cross links (optional for STP, but let's stick to simple first)
    // Connection DSW1-ASW2 and DSW2-ASW1 would create loops.
    // Let's create a loop for STP:
    // DSW1-ASW1 (Gi1/0/1 - Gi1/0/1)
    // DSW2-ASW2 (Gi1/0/1 - Gi1/0/1)
    // ASW1-ASW2 (Gi1/0/2 - Gi1/0/2) -> Creating a ring DSW1-DSW2-ASW2-ASW1

    addConn(asw1, 'Gi1/0/2', asw2, 'Gi1/0/2');

    // 3. PC Connections
    addConn(asw1, 'Gi1/0/10', pc1, 'eth0');
    addConn(asw2, 'Gi1/0/10', pc2, 'eth0');

    state.connections = conns;

    // --- Configurations ---

    // DSW1
    dsw1.etherChannels.push({ id: 1, protocol: 'lacp', status: 'up' });
    dsw1.ports.find(p => p.name === 'Gi1/0/23')!.channelGroup = 1;
    dsw1.ports.find(p => p.name === 'Gi1/0/24')!.channelGroup = 1;
    // Po1 Trunk
    const po1d1 = { ...createL3SwitchPorts()[0], id: generateId(), name: 'Port-channel1', mode: 'trunk', trunkAllowedVlans: [1, 10, 20] } as Port;
    dsw1.ports.push(po1d1);

    // DSW2
    dsw2.etherChannels.push({ id: 1, protocol: 'lacp', status: 'up' });
    dsw2.ports.find(p => p.name === 'Gi1/0/23')!.channelGroup = 1;
    dsw2.ports.find(p => p.name === 'Gi1/0/24')!.channelGroup = 1;
    const po1d2 = { ...createL3SwitchPorts()[0], id: generateId(), name: 'Port-channel1', mode: 'trunk', trunkAllowedVlans: [1, 10, 20] } as Port;
    dsw2.ports.push(po1d2);

    // Trunks on Physical Links
    const setTrunk = (dev: Device, portName: string) => {
        const p = dev.ports.find(port => port.name === portName);
        if (p) { p.mode = 'trunk'; p.trunkAllowedVlans = [1, 10, 20]; }
    };

    setTrunk(dsw1, 'Gi1/0/1'); // DSW1->ASW1
    setTrunk(asw1, 'Gi1/0/1'); // ASW1->DSW1 uplk
    setTrunk(dsw2, 'Gi1/0/1'); // DSW2->ASW2
    setTrunk(asw2, 'Gi1/0/1'); // ASW2->DSW2 uplk

    setTrunk(asw1, 'Gi1/0/2'); // ASW1->ASW2
    setTrunk(asw2, 'Gi1/0/2'); // ASW2->ASW1

    // Access Ports
    const setAccess = (dev: Device, portName: string, vlan: number) => {
        const p = dev.ports.find(port => port.name === portName);
        if (p) { p.mode = 'access'; p.vlan = vlan; }
    };
    setAccess(asw1, 'Gi1/0/10', 10); // PC1 Vlan 10
    setAccess(asw2, 'Gi1/0/10', 10); // PC2 Vlan 10

    // PC IP Config
    pc1.ipAddress = '192.168.10.1';
    pc1.defaultGateway = '192.168.10.254';
    pc2.ipAddress = '192.168.10.2';
    pc2.defaultGateway = '192.168.10.254';

    // SVI (HSRP) on DSW1/2 for Vlan 10
    dsw1.hsrpGroups.push({ group: 10, virtualIp: '192.168.10.254', priority: 110, preempt: true, state: 'active', helloTimer: 3, holdTimer: 10 });
    dsw2.hsrpGroups.push({ group: 10, virtualIp: '192.168.10.254', priority: 90, preempt: true, state: 'standby', helloTimer: 3, holdTimer: 10 });

    return state;
};

buildScenario(initialState);

// ========== Zustand Store ==========

export const useNetworkStore = create<NetworkStore>()(
    persist(
        (set, get) => ({
            ...initialState,

            // デバイス追加
            addDevice: (device) => {
                set((state) => ({
                    devices: [...state.devices, device],
                }));
            },

            // デバイス削除
            removeDevice: (deviceId) => {
                const state = get();
                const device = state.devices.find((d) => d.id === deviceId);

                if (!device) return;

                // 関連する接続を削除
                const connectionsToRemove = state.connections.filter(
                    (c) => c.sourceDeviceId === deviceId || c.targetDeviceId === deviceId
                );

                // 接続先のポートを解放
                const updatedDevices = state.devices
                    .filter((d) => d.id !== deviceId)
                    .map((d) => {
                        const updatedPorts = d.ports.map((port) => {
                            const conn = connectionsToRemove.find(
                                (c) =>
                                    (c.sourceDeviceId === d.id && c.sourcePortId === port.id) ||
                                    (c.targetDeviceId === d.id && c.targetPortId === port.id)
                            );
                            if (conn) {
                                return { ...port, connectedTo: null };
                            }
                            return port;
                        });
                        return { ...d, ports: updatedPorts };
                    });

                set({
                    devices: updatedDevices,
                    connections: state.connections.filter(
                        (c) => c.sourceDeviceId !== deviceId && c.targetDeviceId !== deviceId
                    ),
                    selectedDeviceId: state.selectedDeviceId === deviceId ? null : state.selectedDeviceId,
                });
            },

            // デバイス更新
            updateDevice: (deviceId, updates) => {
                set((state) => ({
                    devices: state.devices.map((d) =>
                        d.id === deviceId ? { ...d, ...updates } as Device : d
                    ),
                }));
            },

            // デバイス位置更新
            updateDevicePosition: (deviceId, position) => {
                set((state) => ({
                    devices: state.devices.map((d) =>
                        d.id === deviceId ? { ...d, position } : d
                    ),
                }));
            },

            // 接続追加
            addConnection: (connection) => {
                set((state) => ({
                    connections: [...state.connections, connection],
                }));
            },

            // 接続削除
            removeConnection: (connectionId) => {
                const state = get();
                const connection = state.connections.find((c) => c.id === connectionId);

                if (!connection) return;

                // ポートの接続状態を解除
                set({
                    devices: state.devices.map((d) => {
                        if (d.id === connection.sourceDeviceId || d.id === connection.targetDeviceId) {
                            return {
                                ...d,
                                ports: d.ports.map((port) => {
                                    if (port.id === connection.sourcePortId || port.id === connection.targetPortId) {
                                        return { ...port, connectedTo: null };
                                    }
                                    return port;
                                }),
                            } as Device;
                        }
                        return d;
                    }),
                    connections: state.connections.filter((c) => c.id !== connectionId),
                });
            },

            // デバイス選択
            selectDevice: (deviceId) => {
                set({ selectedDeviceId: deviceId });
            },

            // PC設定更新
            updatePCConfig: (deviceId, config) => {
                set((state) => ({
                    devices: state.devices.map((d) => {
                        if (d.id === deviceId && d.type === 'pc') {
                            return {
                                ...d,
                                hostname: config.hostname,
                                ipAddress: config.ipAddress,
                                subnetMask: config.subnetMask,
                                defaultGateway: config.defaultGateway,
                            } as PC;
                        }
                        return d;
                    }),
                }));
            },

            // ポート接続
            connectPorts: (sourceDeviceId, sourcePortId, targetDeviceId, targetPortId) => {
                const connectionId = generateId();

                set((state) => ({
                    devices: state.devices.map((d) => {
                        if (d.id === sourceDeviceId) {
                            return {
                                ...d,
                                ports: d.ports.map((p) =>
                                    p.id === sourcePortId ? { ...p, connectedTo: targetPortId } : p
                                ),
                            } as Device;
                        }
                        if (d.id === targetDeviceId) {
                            return {
                                ...d,
                                ports: d.ports.map((p) =>
                                    p.id === targetPortId ? { ...p, connectedTo: sourcePortId } : p
                                ),
                            } as Device;
                        }
                        return d;
                    }),
                    connections: [
                        ...state.connections,
                        {
                            id: connectionId,
                            sourceDeviceId,
                            sourcePortId,
                            targetDeviceId,
                            targetPortId,
                            status: 'up',
                        },
                    ],
                }));
            },

            // ポート切断
            disconnectPort: (deviceId, portId) => {
                const state = get();
                const connection = state.connections.find(
                    (c) =>
                        (c.sourceDeviceId === deviceId && c.sourcePortId === portId) ||
                        (c.targetDeviceId === deviceId && c.targetPortId === portId)
                );

                if (connection) {
                    get().removeConnection(connection.id);
                }
            },



            // JSON エクスポート
            exportToJson: () => {
                const state = get();
                return JSON.stringify(
                    {
                        version: '1.0',
                        exportedAt: new Date().toISOString(),
                        devices: state.devices,
                        connections: state.connections,
                    },
                    null,
                    2
                );
            },

            // JSON インポート
            importFromJson: (json) => {
                try {
                    const data = JSON.parse(json);
                    if (!data.devices || !data.connections) {
                        console.error('Invalid JSON format');
                        return false;
                    }
                    set({
                        devices: data.devices,
                        connections: data.connections,
                        selectedDeviceId: null,
                    });
                    return true;
                } catch (e) {
                    console.error('Failed to import JSON:', e);
                    return false;
                }
            },

            // 状態リセット
            resetState: () => {
                set({
                    devices: [],
                    connections: [],
                    selectedDeviceId: null,
                    terminalStates: {},
                });
            },

            // ターミナル状態更新
            updateTerminalState: (deviceId, state) => {
                set((prev) => ({
                    terminalStates: {
                        ...prev.terminalStates,
                        [deviceId]: {
                            ...prev.terminalStates[deviceId],
                            ...state,
                        },
                    },
                }));
            },

            // ターミナル状態取得
            getTerminalState: (deviceId) => {
                return get().terminalStates[deviceId];
            },
        }),
        {
            name: 'network-simulator-storage',
            version: 1,
        }
    )
);

export default useNetworkStore;
