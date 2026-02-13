
import { createL3Switch, createPC, createL2Switch, useNetworkStore } from '../src/stores/useNetworkStore';
import { processCliCommand, CommandContext } from '../src/lib/cliParser';

const runTest = () => {
    console.log("=== Starting ARP Delay Verification ===");

    // 1. Setup Topology
    const dsw = createL3Switch('DSW', { x: 0, y: 0 });
    const pc = createPC('PC1', { x: 100, y: 0 });

    // Config IP
    // DSW Vlan1 (SVI)
    dsw.hsrpGroups.push({
        group: 1,
        virtualIp: '192.168.1.254',
        priority: 100,
        preempt: true,
        state: 'active',
        helloTimer: 3,
        holdTimer: 10
    });
    // Or Routed Port? Let's use Routed Port for simplicity in test
    const p1 = dsw.ports[0];
    p1.mode = 'routed';
    p1.ipAddress = '192.168.1.254';
    p1.subnetMask = '255.255.255.0';
    p1.status = 'up';

    pc.ipAddress = '192.168.1.1';
    pc.subnetMask = '255.255.255.0';
    pc.defaultGateway = '192.168.1.254';
    const eth0 = pc.ports[0];
    eth0.status = 'up';

    // Connect
    p1.connectedTo = eth0.id;
    eth0.connectedTo = p1.id;

    useNetworkStore.setState({
        devices: [dsw, pc],
        connections: [{
            id: 'conn1',
            sourceDeviceId: dsw.id,
            sourcePortId: p1.id,
            targetDeviceId: pc.id,
            targetPortId: eth0.id,
            status: 'up'
        }],
        selectedDeviceId: null,
        terminalStates: {}
    });

    const ctx: CommandContext = {
        device: dsw,
        mode: 'privileged',
        updateDevice: (id, updates) => {
            useNetworkStore.getState().updateDevice(id, updates);
            Object.assign(dsw, updates); // Update local ref
        },
        allDevices: [dsw, pc],
        allConnections: useNetworkStore.getState().connections // dynamic ref if needed
    };

    // 2. Initial State: Empty ARP
    console.log(`\n[Test 1] Initial ARP Check`);
    if (dsw.arpTable.length === 0) {
        console.log("PASS: ARP Table empty.");
    } else {
        console.error("FAIL: ARP Table not empty.");
    }

    // 3. Ping from DSW to PC (First time) - Expect .!!!!
    console.log(`\n[Test 2] First Ping (192.168.1.1)`);
    const res1 = processCliCommand('ping 192.168.1.1', ctx);
    console.log(res1.output.join('\n'));

    // Manual update store from command result
    if (res1.updateConfig) {
        ctx.updateDevice(dsw.id, res1.updateConfig);
    }

    const out1 = res1.output.join('\n');
    if (out1.includes('.!!!!') && out1.includes('Success rate is 80 percent')) {
        console.log("PASS: First ping result is .!!!! (80%)");
    } else {
        console.error("FAIL: First ping result unsupported or wrong.");
        console.log("Received:", out1);
    }

    // Check ARP Table
    const entry = dsw.arpTable.find(e => e.ipAddress === '192.168.1.1');
    if (entry && entry.macAddress === pc.macAddress) {
        console.log("PASS: ARP Entry learned.");
    } else {
        console.error("FAIL: ARP Entry missing.");
    }

    // 4. Ping Second time - Expect !!!!!
    console.log(`\n[Test 3] Second Ping (192.168.1.1)`);
    const res2 = processCliCommand('ping 192.168.1.1', ctx);
    console.log(res2.output.join('\n'));

    const out2 = res2.output.join('\n');
    if (out2.includes('!!!!!') && out2.includes('Success rate is 100 percent')) {
        console.log("PASS: Second ping result is !!!!! (100%)");
    } else {
        console.error("FAIL: Second ping result mismatch.");
    }

    console.log("=== Done ===");
};

runTest();
