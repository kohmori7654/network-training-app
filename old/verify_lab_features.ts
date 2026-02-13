
import { createL3Switch, createPC } from '../src/stores/useNetworkStore';
import { processCliCommand, CommandContext } from '../src/lib/cliParser';
import { checkConnectivity } from '../src/lib/connectivityEngine';
import { Device, L3Switch, Connection } from '../src/stores/types';

// Mock context creator
const createMockContext = (device: Device): CommandContext => ({
    device,
    mode: 'global-config',
    updateDevice: (id, updates) => {
        Object.assign(device, updates);
    },
    allDevices: [device],
    allConnections: [],
});

// Helper to execute and apply
const execCmd = (cmd: string, ctx: CommandContext) => {
    console.log(`CMD: ${cmd}`);
    const res = processCliCommand(cmd, ctx);
    if (res.updateConfig) {
        Object.assign(ctx.device, res.updateConfig);
    }
    if (res.newMode) ctx.mode = res.newMode;
    if (res.newInterface) ctx.currentInterface = res.newInterface;
    if (res.selectedPortIds) ctx.selectedPortIds = res.selectedPortIds;
    return res;
};

const runTest = () => {
    console.log("=== Starting Lab Features Verification ===");

    // 1. Interface Range Test
    console.log("\n[Test 1] Interface Range & Shutdown");
    const sw1 = createL3Switch('SW1', { x: 0, y: 0 });
    const ctx1 = createMockContext(sw1);

    // Select range
    const res = execCmd("interface range Gi1/0/1-2", ctx1);

    if (res.selectedPortIds && res.selectedPortIds.length === 2) {
        console.log("PASS: Range selected 2 ports");

        // Disable ports
        execCmd("shutdown", ctx1);

        const p1 = sw1.ports.find(p => p.name === 'Gi1/0/1');
        const p2 = sw1.ports.find(p => p.name === 'Gi1/0/2');

        if (p1?.status === 'admin-down' && p2?.status === 'admin-down') {
            console.log("PASS: Both ports in range are admin-down");
        } else {
            console.error("FAIL: Ports not shutdown", p1?.status, p2?.status);
        }
    } else {
        console.error("FAIL: Range selection failed or returned no IDs", res);
    }

    // 2. Routed Port Test
    console.log("\n[Test 2] Routed Port Configuration");
    const sw2 = createL3Switch('SW2', { x: 0, y: 0 });
    const ctx2 = createMockContext(sw2);

    // Enter interface (Mock manual selection if not range)
    ctx2.mode = 'interface-config';
    ctx2.currentInterface = 'Gi1/0/1';
    ctx2.selectedPortIds = [sw2.ports.find(p => p.name === 'Gi1/0/1')!.id];

    execCmd("no switchport", ctx2);

    if (sw2.ports.find(p => p.name === 'Gi1/0/1')?.mode === 'routed') {
        console.log("PASS: Port mode changed to 'routed'");
    } else {
        console.error("FAIL: Port mode is", sw2.ports.find(p => p.name === 'Gi1/0/1')?.mode);
    }

    execCmd("ip address 10.0.0.1 255.255.255.0", ctx2);

    const p1 = sw2.ports.find(p => p.name === 'Gi1/0/1');
    if (p1?.ipAddress === '10.0.0.1') {
        console.log("PASS: IP address assigned");
    } else {
        console.error("FAIL: IP address not assigned", p1);
    }

    // 3. Connectivity Test (Mocked Graph)
    console.log("\n[Test 3] L3 Connected Routes Ping");
    const sw3 = createL3Switch('SW3', { x: 0, y: 0 }); // 10.0.0.1
    const sw4 = createL3Switch('SW4', { x: 0, y: 0 }); // 10.0.0.2

    const p3_1 = sw3.ports.find(p => p.name === 'Gi1/0/1')!;
    const p4_1 = sw4.ports.find(p => p.name === 'Gi1/0/1')!;

    p3_1.mode = 'routed'; p3_1.ipAddress = '10.0.0.1'; p3_1.subnetMask = '255.255.255.0'; p3_1.status = 'up';
    p4_1.mode = 'routed'; p4_1.ipAddress = '10.0.0.2'; p4_1.subnetMask = '255.255.255.0'; p4_1.status = 'up';

    p3_1.connectedTo = p4_1.id;
    p4_1.connectedTo = p3_1.id;

    const connection: Connection = {
        id: 'conn1',
        sourceDeviceId: sw3.id,
        sourcePortId: p3_1.id,
        targetDeviceId: sw4.id,
        targetPortId: p4_1.id,
        status: 'up'
    };

    const devices = [sw3, sw4];
    const connections = [connection];

    // Connectivity Engine
    const result = checkConnectivity(devices, connections, sw3.id, '10.0.0.2');
    if (result.success && result.reachable) {
        console.log("PASS: Ping 10.0.0.2 successful from SW3");
    } else {
        console.error("FAIL: Ping failed", result);
    }

    console.log("=== Done ===");
};

runTest();
