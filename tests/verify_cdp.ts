
import { createL3Switch, createL2Switch, useNetworkStore } from '../src/stores/useNetworkStore';
import { processCliCommand, CommandContext } from '../src/lib/cliParser';

const runTest = () => {
    console.log("=== Starting CDP Verification ===");

    // 1. Setup Topology
    const l3 = createL3Switch('Core-SW', { x: 0, y: 0 });
    const l2 = createL2Switch('Access-SW', { x: 100, y: 0 });

    // Connect L3 Gi1/0/1 <-> L2 Gi1/0/1
    const l3Port = l3.ports[0];
    const l2Port = l2.ports[0];

    // Manual connection setup
    l3Port.connectedTo = l2Port.id;
    l2Port.connectedTo = l3Port.id;
    l3Port.status = 'up'; // Force up
    l2Port.status = 'up';

    const conn = {
        id: 'conn1',
        sourceDeviceId: l3.id,
        sourcePortId: l3Port.id,
        targetDeviceId: l2.id,
        targetPortId: l2Port.id,
        status: 'up' as const
    };

    useNetworkStore.setState({
        devices: [l3, l2],
        connections: [conn],
        selectedDeviceId: null,
        terminalStates: {}
    });

    const devices = [l3, l2];
    const conns = [conn];

    const ctx: CommandContext = {
        device: l3,
        mode: 'privileged',
        updateDevice: () => { },
        allDevices: devices,
        allConnections: conns
    };

    // 2. Execute show cdp neighbors on L3 Switch
    console.log(`\nCMD: show cdp neighbors (on ${l3.hostname})`);
    const res = processCliCommand('show cdp neighbors', ctx);

    console.log(res.output.join('\n'));

    // 3. Verify Output
    const output = res.output.join('\n');
    const hasHostname = output.includes('Access-SW');
    const hasLocalInt = output.includes('Gig 1/0/1');
    const hasPlatform = output.includes('C2960');

    if (hasHostname && hasLocalInt && hasPlatform) {
        console.log("\nPASS: CDP entry found.");
    } else {
        console.error("\nFAIL: Missing CDP info.");
        if (!hasHostname) console.error("- Missing Hostname");
        if (!hasLocalInt) console.error("- Missing Local Interface");
        if (!hasPlatform) console.error("- Missing Platform");
    }

    console.log("=== Done ===");
};

runTest();
