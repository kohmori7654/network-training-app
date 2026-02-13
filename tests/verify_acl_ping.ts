
import { createL3Switch, createPC } from '../src/stores/useNetworkStore';
import { checkConnectivity } from '../src/lib/connectivityEngine';
import { Device, L3Switch, PC, Connection, Port } from '../src/stores/types';

const runTest = () => {
    console.log("=== Starting ACL/Ping Verification ===");

    // 1. Setup Topology: PC1 -- L3SW -- PC2
    const sw = createL3Switch('SW1', { x: 100, y: 100 });
    const pc1 = createPC('PC1', { x: 0, y: 100 });
    const pc2 = createPC('PC2', { x: 200, y: 100 });

    // IPs
    pc1.ipAddress = '10.1.1.1';
    pc1.subnetMask = '255.0.0.0';
    pc1.defaultGateway = '10.1.1.254';

    pc2.ipAddress = '10.2.2.1';
    pc2.subnetMask = '255.0.0.0';
    pc2.defaultGateway = '10.2.2.254';

    // SW1 Ports
    const p1 = sw.ports[0]; // Gi1/0/1
    p1.mode = 'routed';
    p1.ipAddress = '10.1.1.254';
    p1.subnetMask = '255.0.0.0';

    const p2 = sw.ports[1]; // Gi1/0/2
    p2.mode = 'routed';
    p2.ipAddress = '10.2.2.254';
    p2.subnetMask = '255.0.0.0';

    // Connections
    const connections: Connection[] = [
        { id: 'c1', sourceDeviceId: pc1.id, sourcePortId: pc1.ports[0].id, targetDeviceId: sw.id, targetPortId: p1.id, status: 'up' },
        { id: 'c2', sourceDeviceId: pc2.id, sourcePortId: pc2.ports[0].id, targetDeviceId: sw.id, targetPortId: p2.id, status: 'up' },
    ];
    // Sync port connections
    pc1.ports[0].connectedTo = p1.id;
    p1.connectedTo = pc1.ports[0].id;
    pc2.ports[0].connectedTo = p2.id;
    p2.connectedTo = pc2.ports[0].id;

    const allDevices = [sw, pc1, pc2];

    // --- TEST 1: No ACL (Should pass) ---
    console.log("\n[Test 1] No ACL: PC1 -> PC2 Ping");
    const res1 = checkConnectivity(allDevices, connections, pc1.id, '10.2.2.1');
    if (res1.reachable) {
        console.log("PASS: Ping reachable without ACL.");
    } else {
        console.error("FAIL: Ping unreachable without ACL.", res1.errors);
    }

    // --- TEST 2: Deny PC1 -> PC2 (Inbound at Gi1/0/1) ---
    console.log("\n[Test 2] ACL Deny (Inbound): Deny 10.1.1.1 -> Any");
    sw.accessLists = [{
        id: 100,
        type: 'extended',
        entries: [
            { sequence: 10, action: 'deny', protocol: 'ip', sourceIp: '10.1.1.1', sourceWildcard: '0.0.0.0', destinationIp: '0.0.0.0', destinationWildcard: '255.255.255.255' },
            { sequence: 20, action: 'permit', protocol: 'ip', sourceIp: '0.0.0.0', sourceWildcard: '255.255.255.255', destinationIp: '0.0.0.0', destinationWildcard: '255.255.255.255' }
        ]
    }];
    p1.accessGroupIn = 100;

    const res2 = checkConnectivity(allDevices, connections, pc1.id, '10.2.2.1');
    if (!res2.reachable) {
        console.log("PASS: Ping blocked by ACL (Inbound).");
    } else {
        console.error("FAIL: Ping allowed despite ACL deny.");
    }

    // --- TEST 3: Permit back ---
    console.log("\n[Test 3] ACL Permit: Change entry to permit");
    sw.accessLists[0].entries[0].action = 'permit';
    const res3 = checkConnectivity(allDevices, connections, pc1.id, '10.2.2.1');
    if (res3.reachable) {
        console.log("PASS: Ping reachable after ACL permit.");
    } else {
        console.error("FAIL: Ping still blocked after conversion to permit.");
    }

    console.log("=== Done ===");
};

runTest();
