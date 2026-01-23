
import { createL3Switch } from '../src/stores/useNetworkStore';
import { Device, L3Switch, Connection } from '../src/stores/types';
import { calculateRoutes } from '../src/lib/routingEngine';

const runTest = () => {
    console.log("=== Starting Routing Lab Verification (OSPF/BGP/Redistribution) ===");

    // 1. Setup Topology
    // R1 --(10.1.1.0/8)-- R2 --(1.1.1.0/8)-- R3
    const r1 = createL3Switch('R1', { x: 0, y: 0 });
    const r2 = createL3Switch('R2', { x: 100, y: 0 });
    const r3 = createL3Switch('R3', { x: 200, y: 0 });

    // Setup Ports & IP
    // R1 Gi1/0/1 <-> R2 Gi1/0/1
    // R2 Gi1/0/2 <-> R3 Gi1/0/1

    // R1
    const p1 = r1.ports.find(p => p.name === 'Gi1/0/1')!;
    p1.status = 'up'; p1.mode = 'routed'; p1.ipAddress = '10.1.1.1'; p1.subnetMask = '255.0.0.0';

    // R2
    const p2_east = r2.ports.find(p => p.name === 'Gi1/0/1')!;
    p2_east.status = 'up'; p2_east.mode = 'routed'; p2_east.ipAddress = '10.1.1.2'; p2_east.subnetMask = '255.0.0.0';

    const p2_west = r2.ports.find(p => p.name === 'Gi1/0/2')!;
    p2_west.status = 'up'; p2_west.mode = 'routed'; p2_west.ipAddress = '1.1.1.2'; p2_west.subnetMask = '255.0.0.0';

    // R3
    const p3 = r3.ports.find(p => p.name === 'Gi1/0/1')!;
    p3.status = 'up'; p3.mode = 'routed'; p3.ipAddress = '1.1.1.1'; p3.subnetMask = '255.0.0.0';

    // R3 LAN (Mock)
    const p3_lan = {
        id: 'p3_lan',
        name: 'Gi1/0/2',
        status: 'up',
        mode: 'routed',
        ipAddress: '192.168.2.1',
        subnetMask: '255.255.255.0',
        connectedTo: null
    } as any;
    r3.ports.push(p3_lan);

    // Connections
    const connections: Connection[] = [
        { id: 'c1', sourceDeviceId: r1.id, sourcePortId: p1.id, targetDeviceId: r2.id, targetPortId: p2_east.id, status: 'up' },
        { id: 'c2', sourceDeviceId: r2.id, sourcePortId: p2_west.id, targetDeviceId: r3.id, targetPortId: p3.id, status: 'up' },
    ];

    const devices = [r1, r2, r3];

    // 2. Configure Routing
    // R1: OSPF Area 0 (10.0.0.0/8)
    r1.ospfConfig = {
        processId: 1,
        networks: [{ network: '10.0.0.0', wildcard: '0.255.255.255', area: 0 }]
    };

    // R2: OSPF Area 0, BGP 65001, Redistribute BGP->OSPF
    r2.ospfConfig = {
        processId: 1,
        networks: [{ network: '10.0.0.0', wildcard: '0.255.255.255', area: 0 }],
        redistribute: [{ protocol: 'bgp', asNumber: 65001 }]
    };
    r2.bgpConfig = {
        asNumber: 65001,
        neighbors: [{ ip: '1.1.1.1', remoteAs: 65002 }],
        networks: [{ network: '10.0.0.0', mask: '255.0.0.0' }],
        redistribute: []
    };

    // R3: BGP 65002
    r3.bgpConfig = {
        asNumber: 65002,
        neighbors: [{ ip: '1.1.1.2', remoteAs: 65001 }],
        networks: [
            { network: '1.0.0.0', mask: '255.0.0.0' },
            { network: '192.168.2.0', mask: '255.255.255.0' }
        ]
    };

    // 3. Run Routing Engine
    console.log("Running Routing Calculation...");
    const routeMap = calculateRoutes(devices, connections);

    // 4. Verify
    console.log("\nResults:");

    // R1 Routes (Expected: 192.168.2.0/24 from OSPF redistribution)
    const r1Routes = routeMap.get(r1.id) || [];
    console.log(`R1 Routes:`);
    r1Routes.forEach(r => console.log(`  ${r.protocol.toUpperCase()} ${r.network}/${r.mask} via ${r.nextHop}`));

    const hasBgpFromR2 = r1Routes.find(r => r.network === '192.168.2.0');

    if (hasBgpFromR2) console.log("PASS: R1 learned 192.168.2.0/24 (OSPF External)");
    else console.error("FAIL: R1 did not learn 192.168.2.0/24");

    // R3 Routes (Expected: 10.0.0.0/8 from BGP)
    const r3Routes = routeMap.get(r3.id) || [];
    console.log(`R3 Routes:`);
    r3Routes.forEach(r => console.log(`  ${r.protocol.toUpperCase()} ${r.network}/${r.mask} via ${r.nextHop}`));

    const hasOspfFromR2 = r3Routes.find(r => r.network === '10.0.0.0');
    if (hasOspfFromR2) console.log("PASS: R3 learned 10.0.0.0/8 (BGP)");
    else console.error("FAIL: R3 did not learn 10.0.0.0/8");
};

runTest();
