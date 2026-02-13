
import { createL2Switch, createPC, useNetworkStore } from '../src/stores/useNetworkStore';
import { processCliCommand, CommandContext } from '../src/lib/cliParser';

// Mock execCmd to simulate CLI interaction
const execCmd = (cmd: string, ctx: CommandContext) => {
    console.log(`CMD: ${cmd}`);
    const res = processCliCommand(cmd, ctx);
    if (res.updateConfig) {
        Object.assign(ctx.device, res.updateConfig);
    }
    return res;
};

const runTest = () => {
    console.log("=== Starting Port Status Verification (Cisco Compliant) ===");

    // 1. Initial State Check
    const sw = createL2Switch('SW1', { x: 0, y: 0 });
    const p1 = sw.ports[0]; // Gi1/0/1

    console.log(`[Test 1] Initial Port Status: ${p1.status} (Expected: down, connectedTo: null)`);
    if (p1.status === 'down' && p1.connectedTo === null) {
        console.log("PASS: Initial status is down.");
    } else {
        console.error(`FAIL: Initial status is ${p1.status}`);
    }

    // Initialize Store for connection logic testing
    useNetworkStore.setState({
        devices: [sw],
        connections: [],
        selectedDeviceId: null,
        terminalStates: {}
    });

    // 2. Connect Cable Check
    const pc = createPC('PC1', { x: 100, y: 0 });
    useNetworkStore.getState().addDevice(pc);

    console.log("\n[Test 2] Connecting Cable (SW1 Gi1/0/1 <-> PC1 eth0)");
    useNetworkStore.getState().connectPorts(sw.id, p1.id, pc.id, pc.ports[0].id);

    // Fetch updated device from store
    const swUpdated = useNetworkStore.getState().devices.find(d => d.id === sw.id)!;
    const p1Connected = swUpdated.ports.find(p => p.id === p1.id)!;

    console.log(`Port Status after connect: ${p1Connected.status} (Expected: up)`);
    if (p1Connected.status === 'up') {
        console.log("PASS: Port went up after connection.");
    } else {
        console.error(`FAIL: Port status is ${p1Connected.status}`);
    }

    // 3. Shutdown Command Check
    console.log("\n[Test 3] Configuring 'shutdown'");
    const ctx: CommandContext = {
        device: swUpdated,
        mode: 'interface-config',
        currentInterface: 'Gi1/0/1',
        updateDevice: (id, updates) => useNetworkStore.getState().updateDevice(id, updates),
        allDevices: [swUpdated, pc],
        allConnections: useNetworkStore.getState().connections
    };

    execCmd("shutdown", ctx);

    // Check Status
    const p1Shut = swUpdated.ports.find(p => p.id === p1.id)!;
    console.log(`Port Status after shutdown: ${p1Shut.status} (Expected: admin-down)`);
    if (p1Shut.status === 'admin-down') {
        console.log("PASS: Port is admin-down.");
    } else {
        console.error(`FAIL: Port status is ${p1Shut.status}`);
    }

    // 4. Disconnect Cable while Admin-Down
    console.log("\n[Test 4] Disconnect Cable while Admin-Down");
    useNetworkStore.getState().disconnectPort(swUpdated.id, p1.id);

    const swDisconnected = useNetworkStore.getState().devices.find(d => d.id === sw.id)!;
    const p1Disconnected = swDisconnected.ports.find(p => p.id === p1.id)!;

    console.log(`Port Status after disconnect (was admin-down): ${p1Disconnected.status} (Expected: admin-down)`);
    if (p1Disconnected.status === 'admin-down') {
        console.log("PASS: Port remained admin-down after disconnect.");
    } else {
        console.error(`FAIL: Port status changed to ${p1Disconnected.status}`);
    }

    // 5. No Shutdown while Disconnected
    console.log("\n[Test 5] 'no shutdown' while disconnected");
    const ctx2: CommandContext = {
        device: swDisconnected,
        mode: 'interface-config',
        currentInterface: 'Gi1/0/1',
        updateDevice: (id, updates) => useNetworkStore.getState().updateDevice(id, updates),
        allDevices: [swDisconnected], // PC removed implicitly for context
        allConnections: []
    };
    // Make sure we simulate context correctly, though execCmd modifies object reference directly in this mock
    // But store updateDevice updates store.

    execCmd("no shutdown", ctx2);

    const p1NoShut = swDisconnected.ports.find(p => p.id === p1.id)!;
    console.log(`Port Status after no shutdown (disconnected): ${p1NoShut.status} (Expected: down)`);
    if (p1NoShut.status === 'down') {
        console.log("PASS: Port is down (not up) after no shutdown without cable.");
    } else {
        console.error(`FAIL: Port status is ${p1NoShut.status}`);
    }

    console.log("=== Done ===");
};

runTest();
