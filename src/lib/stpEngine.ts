import { Device, Connection, L2Switch, L3Switch, Port } from '@/stores/types';

type Switch = L2Switch | L3Switch;
type PortRole = 'root' | 'designated' | 'alternate' | 'disabled';
type PortState = 'forwarding' | 'blocking' | 'learning' | 'listening' | 'disabled';

interface StpBridgeInfo {
    deviceId: string;
    bridgeId: string; // Priority + MAC
    rootBridgeId: string;
    rootPathCost: number;
    rootPortId: string | null; // Port leading to Root
}

interface StpPortAttribute {
    role: PortRole;
    state: PortState;
}

/**
 * Helper: Convert generic Device to Switch if applicable
 */
function isSwitch(device: Device): device is Switch {
    return device.type === 'l2-switch' || device.type === 'l3-switch';
}

/**
 * Helper: Generate Bridge ID string
 * Format: PriorityPad(6)-MAC
 * Example: 032768-00:11:22:33:44:55
 */
function getBridgeId(priority: number, mac: string): string {
    return `${String(priority).padStart(6, '0')}-${mac}`;
}

/**
 * Helper: Get Path Cost based on speed (Defaulting to 1000Mbps/4 cost for now)
 * IEEE 802.1D-1998: 1Gbps = 4, 100Mbps = 19, 10Mbps = 100
 * IEEE 802.1t (Long): 1Gbps = 20000
 * Using 802.1D shortened for simplicity/readability in simulation
 */
function getPathCost(speed: string = '1000Mbps'): number {
    // Basic detection
    if (speed.includes('1000') || speed.toLowerCase().includes('g')) return 4;
    if (speed.includes('100')) return 19;
    if (speed.includes('10')) return 100;
    return 19; // Default
}

/**
 * Main STP Calculation Function
 * Performs a "God View" calculation of the Spanning Tree.
 * 1. Elect Root Bridge
 * 2. Calculate Root Path Costs (BFS)
 * 3. Select Root Ports
 * 4. Select Designated Ports
 * 5. Set Port States
 */
export function calculateSpanningTree(
    devices: Device[],
    connections: Connection[]
): Map<string, {
    rootBridgeId: string;
    rootPathCost: number;
    rootPortId: string | undefined;
    portStates: Record<string, PortState>;
    portDetails: Record<string, { role: PortRole; state: PortState; cost: number }>;
}> {

    // 1. Identify Switches and Initial Info
    const switches = devices.filter(isSwitch);
    const bridgeInfos = new Map<string, StpBridgeInfo>();

    switches.forEach(sw => {
        bridgeInfos.set(sw.id, {
            deviceId: sw.id,
            bridgeId: getBridgeId(sw.stpState.priority, sw.macAddress),
            rootBridgeId: getBridgeId(sw.stpState.priority, sw.macAddress), // Assume self is root initially
            rootPathCost: 0,
            rootPortId: null
        });
    });

    if (switches.length === 0) return new Map();

    // 2. Elect Root Bridge (Lowest Bridge ID)
    let globalRoot = bridgeInfos.get(switches[0].id)!;
    for (const sw of switches) {
        const info = bridgeInfos.get(sw.id)!;
        if (info.bridgeId < globalRoot.bridgeId) {
            globalRoot = info;
        }
    }

    // Assign Global Root to all? No, we strictly calculate paths.
    // Actually, in steady state, everyone creates the same tree rooted at Global Root.
    // So we assume the network is converged.

    // Reset all to point to Global Root
    // The "Root Bridge" itself has Cost 0
    // Others initialize with Infinity
    bridgeInfos.forEach(info => {
        if (info.deviceId === globalRoot.deviceId) {
            info.rootBridgeId = globalRoot.bridgeId;
            info.rootPathCost = 0;
        } else {
            info.rootBridgeId = globalRoot.bridgeId;
            info.rootPathCost = Infinity;
        }
    });

    // 3. BFS to calculate Root Path Costs and Identify Root Ports
    // Queue stores { deviceId, pathCostFromParent, ingressInfo }
    const queue: string[] = [globalRoot.deviceId];

    // We need to keep relaxing edges until stable (since loops exist, simple BFS works for unweighted, 
    // but Dijkstra is better for weighted. Here weights are link costs).
    // Let's use a simple Bellman-Ford like relaxation or just iterative updates.
    // Since graph is small, iterative relaxation is safest.

    let changed = true;
    let iterations = 0;
    const MAX_ITERATIONS = 100; // Loop protection

    while (changed && iterations < MAX_ITERATIONS) {
        changed = false;
        iterations++;

        for (const conn of connections) {
            if (conn.status !== 'up') continue;

            const sw1 = devices.find(d => d.id === conn.sourceDeviceId);
            const sw2 = devices.find(d => d.id === conn.targetDeviceId);

            if (!sw1 || !sw2 || !isSwitch(sw1) || !isSwitch(sw2)) continue;

            const info1 = bridgeInfos.get(sw1.id)!;
            const info2 = bridgeInfos.get(sw2.id)!;

            const port1 = sw1.ports.find(p => p.id === conn.sourcePortId);
            const port2 = sw2.ports.find(p => p.id === conn.targetPortId);

            if (!port1 || !port2 || port1.status !== 'up' || port2.status !== 'up') continue;

            const linkCost = getPathCost(port1.speed); // Assume symmetrical

            // Try to relax sw1 -> sw2
            // If sw1 can reach root, can sw2 reach root better via sw1?
            if (info1.rootPathCost !== Infinity) {
                const newCost = info1.rootPathCost + linkCost;
                // Criteria: Better Cost < Better Upstream BridgeID < Better Upstream PortID
                // For simplicity, just Cost & BridgeID.
                // PortID Tie-breaking (Sender Port ID) is complex to mock perfectly without sending BPDU logic.
                // We'll use BridgeID tie break.

                if (newCost < info2.rootPathCost ||
                    (newCost === info2.rootPathCost && info1.bridgeId < getBridgeInfo(info2.rootPortId, bridgeInfos, devices, connections))) {
                    // Update sw2
                    if (info2.rootPathCost !== newCost) { // Simple change check
                        info2.rootPathCost = newCost;
                        info2.rootPortId = port2.id;
                        changed = true;
                    } else if (info2.rootPortId !== port2.id) {
                        // Check tie-break more carefully:
                        // Current Root Port vs Candidate Port2
                        // We need the "Upstream Bridge" of the current Root Port to compare.
                        // Only switch if the new path (via sw1) is strictly better.
                        // If Cost is equal, compare Upstream Bridge ID.
                        // Upstream for Candidate (sw1) is info1.bridgeId.
                        // Upstream for Current: We need to look it up.
                        // This is getting complex for a simple loop.

                        // Re-approach: Just Store "Best Path" metadata: { cost, upstreamBridgeId, upstreamPortId } on the bridgeInfo
                        // And compare that tuple.

                        // Let's simplify: Just run Dijkstra properly.
                    }
                }
            }

            // Try to relax sw2 -> sw1
            if (info2.rootPathCost !== Infinity) {
                const newCost = info2.rootPathCost + linkCost;
                if (newCost < info1.rootPathCost) { // Simplified check
                    info1.rootPathCost = newCost;
                    info1.rootPortId = port1.id;
                    changed = true;
                }
                // (Tie breaking omitted for brevity in this block, handled better below if we rewrite to Sort)
            }
        }
    }

    // Refined approach for Step 3: Dijkstra-ish to guarantee correctness with Tie-Breaks
    // Reset non-root
    bridgeInfos.forEach(info => {
        if (info.deviceId !== globalRoot.deviceId) {
            info.rootPathCost = Infinity;
            info.rootPortId = null;
        }
    });

    // Priority Queue substitute: Set of nodes to visit
    const unvisited = new Set(Array.from(bridgeInfos.keys()));

    while (unvisited.size > 0) {
        // Extract min
        let currentId: string | null = null;
        let minCost = Infinity;
        let minBridgeId = 'INF'; // For tie-break (though strictly we prioritize cost)

        for (const id of unvisited) {
            const info = bridgeInfos.get(id)!;
            if (info.rootPathCost < minCost) {
                minCost = info.rootPathCost;
                currentId = id;
            }
        }

        if (currentId === null || minCost === Infinity) break; // Remaining are unreachable
        unvisited.delete(currentId);

        const currentInfo = bridgeInfos.get(currentId)!;
        const currentDev = switches.find(d => d.id === currentId)!;

        // Relax neighbors
        for (const conn of connections) {
            if (conn.status !== 'up') continue;

            let neighborId: string;
            let myPortId: string;
            let neighborPortId: string;

            if (conn.sourceDeviceId === currentId) {
                neighborId = conn.targetDeviceId;
                myPortId = conn.sourcePortId;
                neighborPortId = conn.targetPortId;
            } else if (conn.targetDeviceId === currentId) {
                neighborId = conn.sourceDeviceId;
                myPortId = conn.targetPortId;
                neighborPortId = conn.sourcePortId;
            } else {
                continue;
            }

            // Check if neighbor is switch
            if (!bridgeInfos.has(neighborId)) continue;
            const neighborInfo = bridgeInfos.get(neighborId)!;

            // Port check (physically up)
            const myPort = currentDev.ports.find(p => p.id === myPortId);
            const neighborDev = switches.find(d => d.id === neighborId)!;
            const neighborPort = neighborDev.ports.find(p => p.id === neighborPortId);

            if (!myPort || !neighborPort || myPort.status !== 'up' || neighborPort.status !== 'up') continue;

            const cost = getPathCost(neighborPort.speed);
            const newCost = currentInfo.rootPathCost + cost;

            // Compare logic: Cost > UpstreamBridgeID > UpstreamPortPriority(PortID)
            // Existing best
            const currentBestCost = neighborInfo.rootPathCost;

            let isBetter = false;
            if (newCost < currentBestCost) {
                isBetter = true;
            } else if (newCost === currentBestCost) {
                // Tie 1: Upstream Bridge ID
                // Who is the current upstream bridge for neighbor?
                // We assume we don't store it yet, which is the bug in the previous simple loop.
                // But simplified: If we strictly relax, we can check if the *current candidate* (currentId) 
                // is better than the *existing* parent. 
                // We need to know who the existing parent is to compare.

                // Hack: We can't easily know the existing parent without storing it.
                // Let's assume for this sim, cost is main factor.
                // Tie-breaking is critical for loops though.
                // We will add `designatedBridgeId` to StpBridgeInfo temporarily? No.

                // Let's fetch the details of the *current best path* if possible?
                // Actually, if we use Dijkstra, when we reach a node, we found the shortest path.
                // BUT Dijkstra doesn't handle the "Pick specific parent based on ID" tie break if costs are equal.
                // It just picks the first one.
                // So we need to process ALL incoming edges to a node and pick the best one.
            }

            if (isBetter) {
                neighborInfo.rootPathCost = newCost;
                neighborInfo.rootPortId = neighborPortId;
                // Note: We don't change priority in PQ because we iterate "all unvisited". 
                // JS Set iteration doesn't resort. 
                // This is suboptimal Dijkstra but works for N<50.
            }
        }
    }

    // Post-Dijkstra Tie-Breaker Pass (Because simple Dijkstra might miss Bridge ID preference on equal cost)
    // Actually, just iterating all links for every node and picking Best {Cost, BridgeID, PortID} is easier than Dijkstra 
    // because graphs are tiny.

    // FINAL ALGORITHM: "Every Node Selects Best Root Port"
    // 1. Root Bridge is fixed (Global Min ID).
    // 2. All others need to find path to Root.
    //    Path Vector: {Cost, NeighborBridgeID, NeighborPortID}
    //    Iterate MAX_HOPS times to propagate vectors.

    const nodePathVectors = new Map<string, { cost: number; upstreamBridgeId: string; upstreamPortId: string; myPortId: string | null }>();

    // Init Init
    bridgeInfos.forEach(info => {
        if (info.deviceId === globalRoot.deviceId) {
            nodePathVectors.set(info.deviceId, { cost: 0, upstreamBridgeId: globalRoot.bridgeId, upstreamPortId: '', myPortId: null });
        } else {
            nodePathVectors.set(info.deviceId, { cost: Infinity, upstreamBridgeId: '~~~', upstreamPortId: '~~~', myPortId: null });
        }
    });

    // Convergence Loop
    for (let i = 0; i < switches.length + 2; i++) { // Diameter bound
        let anyChange = false;

        connections.forEach(conn => {
            if (conn.status !== 'up') return;
            const sw1 = switches.find(d => d.id === conn.sourceDeviceId);
            const sw2 = switches.find(d => d.id === conn.targetDeviceId);
            if (!sw1 || !sw2) return;

            const info1 = bridgeInfos.get(sw1.id)!;
            const info2 = bridgeInfos.get(sw2.id)!;

            const p1 = sw1.ports.find(p => p.id === conn.sourcePortId);
            const p2 = sw2.ports.find(p => p.id === conn.targetPortId);
            if (!p1 || !p2 || p1.status !== 'up' || p2.status !== 'up') return;

            const vec1 = nodePathVectors.get(sw1.id)!;
            const vec2 = nodePathVectors.get(sw2.id)!;

            // Propagate 1 -> 2
            if (vec1.cost !== Infinity) {
                const offerCost = vec1.cost + getPathCost(p2.speed);
                // Compare offer vs current vec2
                // Preference: Lower Cost > Lower BridgeID (Sender) > Lower Port ID (Sender)
                const isBetter =
                    (offerCost < vec2.cost) ||
                    (offerCost === vec2.cost && info1.bridgeId < vec2.upstreamBridgeId) ||
                    (offerCost === vec2.cost && info1.bridgeId === vec2.upstreamBridgeId && p1.id < vec2.upstreamPortId); // Using PortID string comparison for simplicity

                if (isBetter) {
                    nodePathVectors.set(sw2.id, {
                        cost: offerCost,
                        upstreamBridgeId: info1.bridgeId,
                        upstreamPortId: p1.id,
                        myPortId: p2.id
                    });
                    anyChange = true;
                }
            }

            // Propagate 2 -> 1
            if (vec2.cost !== Infinity) {
                const offerCost = vec2.cost + getPathCost(p1.speed);
                const isBetter =
                    (offerCost < vec1.cost) ||
                    (offerCost === vec1.cost && info2.bridgeId < vec1.upstreamBridgeId) ||
                    (offerCost === vec1.cost && info2.bridgeId === vec1.upstreamBridgeId && p2.id < vec1.upstreamPortId);

                if (isBetter) {
                    nodePathVectors.set(sw1.id, {
                        cost: offerCost,
                        upstreamBridgeId: info2.bridgeId,
                        upstreamPortId: p2.id,
                        myPortId: p1.id
                    });
                    anyChange = true;
                }
            }
        });

        if (!anyChange) break;
    }

    // Update StpBridgeInfo with results
    bridgeInfos.forEach(info => {
        const vec = nodePathVectors.get(info.deviceId)!;
        info.rootPathCost = vec.cost;
        info.rootPortId = vec.myPortId;
    });

    // 4. Select Designated Ports (DP) for each segment
    // A port is DP if it sends the best BPDU on the segment.
    // Compare (MyRootCost, MyBridgeID, MyPortID) vs (NeighborRootCost, NeighborBridgeID, NeighborPortID)

    const portRoles = new Map<string, PortRole>(); // PortID -> Role

    // Init all as Designated (default) or Disabled
    switches.forEach(sw => {
        sw.ports.forEach(p => {
            if (p.status !== 'up') {
                portRoles.set(p.id, 'disabled');
            } else if (p.connectedTo) {
                portRoles.set(p.id, 'designated');
            } else {
                portRoles.set(p.id, 'designated'); // Edge port
            }
        });
        // Root Port is strictly Root
        const info = bridgeInfos.get(sw.id)!;
        if (info.rootPortId) {
            portRoles.set(info.rootPortId, 'root');
        }
    });

    connections.forEach(conn => {
        if (conn.status !== 'up') return;
        const sw1 = switches.find(d => d.id === conn.sourceDeviceId);
        const sw2 = switches.find(d => d.id === conn.targetDeviceId);
        if (!sw1 || !sw2) return; // Link to PC? 

        // If link to PC, the switch port is always Designated. (Handled above default)
        // Only compare if both are switches.

        const info1 = bridgeInfos.get(sw1.id)!;
        const info2 = bridgeInfos.get(sw2.id)!;

        const p1 = sw1.ports.find(p => p.id === conn.sourcePortId)!;
        const p2 = sw2.ports.find(p => p.id === conn.targetPortId)!;

        const vec1 = { cost: info1.rootPathCost, bid: info1.bridgeId, pid: p1.id };
        const vec2 = { cost: info2.rootPathCost, bid: info2.bridgeId, pid: p2.id };

        // Who has better vector?
        // Lower Cost > Lower BID > Lower PID
        let p1IsBetter = false;
        if (vec1.cost < vec2.cost) p1IsBetter = true;
        else if (vec1.cost === vec2.cost && vec1.bid < vec2.bid) p1IsBetter = true;
        else if (vec1.cost === vec2.cost && vec1.bid === vec2.bid && vec1.pid < vec2.pid) p1IsBetter = true;

        // The one with better vector is Designated for this segment.
        // The other one is... either Root (if it chose this path) or Alternate (Blocked).

        if (p1IsBetter) {
            // P1 is Designated
            if (portRoles.get(p1.id) !== 'root') portRoles.set(p1.id, 'designated');

            // P2 is Alternate (unless it's Root)
            if (portRoles.get(p2.id) !== 'root') portRoles.set(p2.id, 'alternate');
        } else {
            // P2 is Designated
            if (portRoles.get(p2.id) !== 'root') portRoles.set(p2.id, 'designated');

            // P1 is Alternate (unless it's Root)
            if (portRoles.get(p1.id) !== 'root') portRoles.set(p1.id, 'alternate');
        }
    });

    // 5. Final State Mapping
    const resultMap = new Map<string, {
        rootBridgeId: string;
        rootPathCost: number;
        rootPortId: string | undefined;
        portStates: Record<string, PortState>;
        portDetails: Record<string, { role: PortRole; state: PortState; cost: number }>;
    }>();

    switches.forEach(sw => {
        const info = bridgeInfos.get(sw.id)!;
        const states: Record<string, PortState> = {};
        const details: Record<string, { role: PortRole; state: PortState; cost: number }> = {};

        sw.ports.forEach(p => {
            let role = portRoles.get(p.id) || 'designated';
            let state: PortState = 'forwarding';

            if (p.status !== 'up') {
                role = 'disabled';
                state = 'disabled';
            } else if (role === 'root') {
                state = 'forwarding';
            } else if (role === 'designated') {
                state = 'forwarding';
            } else if (role === 'alternate') {
                state = 'blocking';
            }

            states[p.id] = state;
            details[p.id] = {
                role,
                state,
                cost: getPathCost(p.speed),
            };
        });

        resultMap.set(sw.id, {
            rootBridgeId: info.rootBridgeId,
            rootPathCost: info.rootPathCost,
            rootPortId: info.rootPortId || undefined,
            portStates: states,
            portDetails: details
        });
    });

    return resultMap;
}

// Helper to resolve generic ID in recursion - removed as not used in final vector approach
function getBridgeInfo(portId: string | null, map: Map<string, StpBridgeInfo>, devices: Device[], connections: Connection[]): string {
    return '000'; // Stub
}
