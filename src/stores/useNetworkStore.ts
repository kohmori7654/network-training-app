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
    NetworkState,
} from './types';
import { calculateSpanningTree } from '../lib/stpEngine';
import { calculateRoutes } from '../lib/routingEngine';

// ========== ヘルパー関数 ==========

const generateId = () => crypto.randomUUID();

const generateMacAddress = () => {
    const hex = () => Math.floor(Math.random() * 256).toString(16).padStart(2, '0');
    return `${hex()}:${hex()}:${hex()}:${hex()}:${hex()}:${hex()}`.toUpperCase();
};

const resolveDtpMode = (p1: Port, p2: Port): { p1Mode: 'access' | 'trunk', p2Mode: 'access' | 'trunk' } => {
    const m1 = p1.dtpMode || 'none';
    const m2 = p2.dtpMode || 'none';
    const static1 = p1.mode; // 'access' | 'trunk'
    const static2 = p2.mode;

    // Helper to get effective DTP intent
    const isTrunking = (me: string, other: string, myStatic: string | undefined, otherStatic: string | undefined) => {
        // If static trunk
        if (myStatic === 'trunk') return true;
        if (myStatic === 'access') return false;

        // Dynamic checks
        if (me === 'dynamic-desirable') {
            return other === 'dynamic-desirable' || other === 'dynamic-auto' || otherStatic === 'trunk';
        }
        if (me === 'dynamic-auto') {
            return other === 'dynamic-desirable' || otherStatic === 'trunk';
        }
        return false;
    };

    // Determine operational mode
    // Cisco logic: If negotiation succeeds, become trunk. Else access.
    // If one side is static Trunk, the other side (if dynamic) becomes Trunk.
    // If one side is static Access, the other side (if dynamic) becomes Access.

    // Check P1
    let p1Res: 'access' | 'trunk' = 'access';
    if (static1 === 'trunk') p1Res = 'trunk';
    else if (static1 === 'access') p1Res = 'access';
    else {
        // P1 is dynamic
        if (isTrunking(m1, m2, static1, static2)) p1Res = 'trunk';
        else p1Res = 'access';
    }

    // Check P2
    let p2Res: 'access' | 'trunk' = 'access';
    if (static2 === 'trunk') p2Res = 'trunk';
    else if (static2 === 'access') p2Res = 'access';
    else {
        // P2 is dynamic
        if (isTrunking(m2, m1, static2, static1)) p2Res = 'trunk';
        else p2Res = 'access';
    }

    return { p1Mode: p1Res, p2Mode: p2Res };
};

// L2スイッチのポート生成（Gi1/0/1 ~ Gi1/0/24）
const createL2SwitchPorts = (): Port[] => {
    return Array.from({ length: 24 }, (_, i) => ({
        id: generateId(),
        name: `Gi1/0/${i + 1}`,
        connectedTo: null,
        status: 'down' as const,
        vlan: 1,
    }));
};

// L3スイッチのポート生成（Gi1/0/1 ~ Gi1/0/24）
const createL3SwitchPorts = (): Port[] => {
    return Array.from({ length: 24 }, (_, i) => ({
        id: generateId(),
        name: `Gi1/0/${i + 1}`,
        connectedTo: null,
        status: 'down' as const,
        vlan: 1,
    }));
};

// PCのポート生成（eth0のみ）
const createPCPorts = (): Port[] => {
    return [{
        id: generateId(),
        name: 'eth0',
        connectedTo: null,
        status: 'down' as const,
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
    macAddress: generateMacAddress(),
    stpState: {
        mode: 'rapid-pvst',
        priority: 32768,
        portStates: {},
        portDetails: {}, // Added
    },
    runningConfig: [
        '!',
        `hostname ${name}`,
        '!',
        'spanning-tree mode rapid-pvst',
        '!',
    ],
    startupConfig: [
        '!',
        `hostname ${name}`,
        '!',
        'spanning-tree mode rapid-pvst',
        '!',
    ],
    etherChannels: [],
    security: {},
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
    macAddress: generateMacAddress(),
    stpState: {
        mode: 'rapid-pvst',
        priority: 32768,
        portStates: {},
        portDetails: {}, // Added
    },
    ospfConfig: { processId: 1, networks: [] },
    bgpConfig: { asNumber: 65000, neighbors: [], networks: [] },
    routingTable: [],
    arpTable: [],
    hsrpGroups: [],
    accessLists: [], // Initialize ACLs
    runningConfig: [
        '!',
        `hostname ${name}`,
        '!',
        'ip routing',
        '!',
    ],
    startupConfig: [
        '!',
        `hostname ${name}`,
        '!',
        'ip routing',
        '!',
    ],
    etherChannels: [],
    security: {},
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
    note: '',
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
        // 接続時はポートステータスをupにする
        p1.status = 'up';
        p2.status = 'up';

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

    // Initialize STP states for all connected ports
    conns.forEach(conn => {
        const updateDevStp = (devId: string, portId: string) => {
            const dev = state.devices.find(d => d.id === devId);
            if (dev && (dev.type === 'l2-switch' || dev.type === 'l3-switch')) {
                const sw = dev as (L2Switch | L3Switch);
                sw.stpState.portStates[portId] = 'forwarding';
            }
        };
        updateDevStp(conn.sourceDeviceId, conn.sourcePortId);
        updateDevStp(conn.targetDeviceId, conn.targetPortId);
    });

    // NOTE: We do not run calculateSpanningTree here because store is not yet created. 
    // It will be calculated once specific actions occur or on initial load if we want.
    // However, persist might overwrite this state anyway.

    return state;
};

buildScenario(initialState);

// ========== Zustand Store ==========

export const useNetworkStore = create<NetworkStore>()(
    persist(
        (set, get) => ({
            ...initialState,

            //Helper to trigger STP recalc
            recalculateStp: () => {
                const { devices, connections } = get();
                const stpResults = calculateSpanningTree(devices, connections);

                set((state) => ({
                    devices: state.devices.map((d) => {
                        const res = stpResults.get(d.id);
                        if (res && (d.type === 'l2-switch' || d.type === 'l3-switch')) {
                            // Merge new STP state
                            const sw = d as L2Switch | L3Switch; // safe cast
                            return {
                                ...sw,
                                stpState: {
                                    ...sw.stpState,
                                    rootBridgeId: res.rootBridgeId,
                                    rootPathCost: res.rootPathCost,
                                    rootPortId: res.rootPortId,
                                    portStates: res.portStates,
                                    portDetails: res.portDetails
                                }
                            };
                        }
                        return d;
                    })
                }));
            },

            recalculateRoutes: () => {
                const { devices, connections } = get();
                const routeResults = calculateRoutes(devices, connections);

                set((state) => ({
                    devices: state.devices.map((d) => {
                        if (d.type === 'l3-switch') {
                            const routes = routeResults.get(d.id);
                            if (routes) {
                                return { ...d, routingTable: routes } as L3Switch;
                            }
                        }
                        return d;
                    })
                }));
            },

            // デバイス追加
            addDevice: (device) => {
                set((state) => ({
                    devices: [...state.devices, device],
                }));
                // No STP recalc needed for pure device add unless it has links pre-configured (unlikely in UI)
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

                // Trigger STP Recalc
                (get() as any).recalculateStp();
                (get() as any).recalculateRoutes();
            },

            // デバイス更新
            updateDevice: (deviceId, updates) => {
                set((state) => ({
                    devices: state.devices.map((d) =>
                        d.id === deviceId ? { ...d, ...updates } as Device : d
                    ),
                }));
                // If priority changes, we should recalc. For now assuming updates are mostly names/IPs.
                // If updates contain stpState (priority), we should trigger.
                if ('stpState' in updates) {
                    (get() as any).recalculateStp();
                }
                (get() as any).recalculateRoutes();
            },

            // デバイス位置更新
            updateDevicePosition: (deviceId, position) => {
                set((state) => ({
                    devices: state.devices.map((d) =>
                        d.id === deviceId ? { ...d, position } : d
                    ),
                }));
            },

            // 接続追加 (Manual)
            addConnection: (connection) => {
                set((state) => ({
                    connections: [...state.connections, connection],
                }));
                (get() as any).recalculateStp();
                (get() as any).recalculateRoutes();
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
                                        // admin-downでないなら、切断時はdown(物理リンクダウン)にする
                                        const newStatus = port.status === 'admin-down' ? 'admin-down' : 'down';
                                        return { ...port, connectedTo: null, status: newStatus };
                                    }
                                    return port;
                                }),
                            } as Device;
                        }
                        return d;
                    }),
                    connections: state.connections.filter((c) => c.id !== connectionId),
                });

                (get() as any).recalculateStp();
                (get() as any).recalculateRoutes();
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
            connectPorts: (sourceDeviceId, sourcePortId, targetDeviceId, targetPortId, sourceHandle, targetHandle) => {
                const connectionId = generateId();

                set((state) => {
                    // Pre-calculate DTP results based on current ports in state
                    const d1 = state.devices.find(d => d.id === sourceDeviceId);
                    const d2 = state.devices.find(d => d.id === targetDeviceId);
                    const p1 = d1?.ports.find(p => p.id === sourcePortId);
                    const p2 = d2?.ports.find(p => p.id === targetPortId);

                    let p1ModeUpdate: 'access' | 'trunk' | undefined = undefined;
                    let p2ModeUpdate: 'access' | 'trunk' | undefined = undefined;

                    if (p1 && p2) {
                        const { p1Mode, p2Mode } = resolveDtpMode(p1, p2);
                        // Only update if it was dynamic (dtpMode is set) or if simulate DTP on static ports? 
                        // Actually, resolveDtpMode returns the *operational* mode. 
                        // We should update the 'mode' property.
                        // But wait, 'mode' property is used for "switchport mode trunk" configuration too.
                        // If user configured "switchport mode dynamic auto", then 'mode' isn't explicitly 'trunk' or 'access' initially?
                        // In our type definitions: mode?: 'access' | 'trunk' | 'dynamic' | 'routed';
                        // So if we update 'mode' to 'trunk', we lose the fact it was 'dynamic'.
                        // Ideally we need 'operationalMode'. 
                        // But for Phase 4 simplicity: We update 'mode' IF the current mode is dynamic-ish?
                        // Or we assume 'mode' in types.ts stores the CONFIG.
                        // And we need another field for OPERATIONAL status.
                        // However, previous code uses 'mode' for logic.
                        // Let's check types.ts: mode?: 'access' | 'trunk' | 'dynamic' | 'routed';
                        // And dtpMode?: ...

                        // User configures: `switchport mode dynamic auto` -> mode='dynamic', dtpMode='dynamic-auto'
                        // System negotiates: -> Operational needs to be calculated.

                        // For this implementation, let's keep 'mode' as the EFFECTIVE mode for traffic/STP, 
                        // but if we overwrite it, we lose the config 'dynamic'.
                        // Wait, if I change mode to 'trunk', show run will say 'switchport mode trunk'.
                        // That is wrong.

                        // We should probably NOT change the stored config 'mode' here if possible, 
                        // unless we add an 'operationalMode' field.
                        // Given constraints, I will add 'operationalMode' to Port type? 
                        // No, let's use 'mode' as operational, and rely on 'dtpMode' to remember it's dynamic.
                        // Re-negotiation happens on connect.
                        // If dtpMode is set, we recalculate 'mode' (operational).

                        p1ModeUpdate = (p1.dtpMode && p1.dtpMode !== 'none') ? p1Mode : undefined;
                        p2ModeUpdate = (p2.dtpMode && p2.dtpMode !== 'none') ? p2Mode : undefined;
                    }

                    return {
                        devices: state.devices.map((d) => {
                            if (d.id === sourceDeviceId) {
                                return {
                                    ...d,
                                    ports: d.ports.map((p) => {
                                        if (p.id === sourcePortId) {
                                            const newStatus = p.status === 'admin-down' ? 'admin-down' : 'up';
                                            const mode = p1ModeUpdate !== undefined ? p1ModeUpdate : p.mode;
                                            return { ...p, connectedTo: targetPortId, status: newStatus, mode };
                                        }
                                        return p;
                                    }),
                                } as Device;
                            }
                            if (d.id === targetDeviceId) {
                                return {
                                    ...d,
                                    ports: d.ports.map((p) => {
                                        if (p.id === targetPortId) {
                                            const newStatus = p.status === 'admin-down' ? 'admin-down' : 'up';
                                            const mode = p2ModeUpdate !== undefined ? p2ModeUpdate : p.mode;
                                            return { ...p, connectedTo: sourcePortId, status: newStatus, mode };
                                        }
                                        return p;
                                    }),
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
                                sourceHandle: sourceHandle || undefined,
                                targetDeviceId,
                                targetPortId,
                                targetHandle: targetHandle || undefined,
                                status: 'up',
                            },
                        ],
                    };
                });

                // Trigger STP Recalc
                (get() as any).recalculateStp();
                (get() as any).recalculateRoutes();
            },

            // Set port STP state (internal/expert use)
            setPortStpState: (deviceId: string, portId: string, state: 'blocking' | 'learning' | 'forwarding') => {
                // Manual override might be overwritten by auto-recalc if topology changes
                set((s) => ({
                    devices: s.devices.map((d) => {
                        if (d.id === deviceId && (d.type === 'l2-switch' || d.type === 'l3-switch')) {
                            return {
                                ...d,
                                stpState: {
                                    ...((d as L2Switch).stpState),
                                    portStates: {
                                        ...((d as L2Switch).stpState.portStates),
                                        [portId]: state
                                    }
                                }
                            } as Device;
                        }
                        return d;
                    })
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
                    get().removeConnection(connection.id); // This already calls recalculateStp
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

            // メモ機能
            setNote: (note) => {
                set({ note });
            },

            // override exportToJson to include note
            exportToJson: () => {
                const state = get();
                return JSON.stringify(
                    {
                        version: '1.1', // Bump version
                        exportedAt: new Date().toISOString(),
                        devices: state.devices,
                        connections: state.connections,
                        note: state.note, // Include note
                    },
                    null,
                    2
                );
            },

            // override importFromJson to read note
            importFromJson: (json) => {
                try {
                    const data = JSON.parse(json);
                    if (!data.devices || !data.connections) {
                        console.error('Invalid JSON format');
                        return false;
                    }
                    set({
                        devices: data.devices.map((d: Device) => ({
                            ...d,
                            ports: d.ports.map((p: Port) => {
                                if (!p.connectedTo && p.status !== 'admin-down') {
                                    return { ...p, status: 'down' };
                                }
                                if (p.connectedTo && p.status === 'down') {
                                    return { ...p, status: 'up' };
                                }
                                return p;
                            })
                        })),
                        connections: data.connections,
                        selectedDeviceId: null,
                        note: data.note || '', // Import note
                    });

                    // Recalc on import
                    (get() as any).recalculateStp();
                    (get() as any).recalculateRoutes();

                    return true;
                } catch (e) {
                    console.error('Failed to import JSON:', e);
                    return false;
                }
            },
        }),
        {
            name: 'network-simulator-storage',
            version: 2, // Version up to force migration
            migrate: (persistedState: any, version: number) => {
                if (version < 2) {
                    // version 1 -> 2: Fix port status inconsistency
                    // 以前のバージョンで未接続なのにupになっているポートをdownに修正
                    const state = persistedState as NetworkState;
                    if (state.devices) {
                        state.devices = state.devices.map((d: Device) => ({
                            ...d,
                            ports: d.ports.map((p: Port) => {
                                if (!p.connectedTo && p.status !== 'admin-down') {
                                    return { ...p, status: 'down' };
                                }
                                if (p.connectedTo && p.status === 'down') {
                                    return { ...p, status: 'up' };
                                }
                                return p;
                            })
                        }));
                    }
                    return state;
                }
                return persistedState as NetworkStore;
            },
        }
    )
);

export default useNetworkStore;
