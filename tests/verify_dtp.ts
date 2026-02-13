
import { createL2Switch, useNetworkStore } from '../src/stores/useNetworkStore';

const runTest = () => {
    console.log("=== Starting DTP Verification ===");

    // 1. Setup Devices
    const sw1 = createL2Switch('SW1', { x: 0, y: 0 });
    const sw2 = createL2Switch('SW2', { x: 100, y: 0 });
    const sw3 = createL2Switch('SW3', { x: 200, y: 0 });

    useNetworkStore.setState({
        devices: [sw1, sw2, sw3],
        connections: [],
        selectedDeviceId: null,
        terminalStates: {}
    });

    const getPort = (swId: string, idx: number) => {
        return useNetworkStore.getState().devices.find(d => d.id === swId)!.ports[idx];
    };

    // Case 1: Auto - Auto (Expect: Access)
    console.log("\n[Test 1] Auto - Auto");
    // Pre-configure ports via updateDevice (simulating CLI config)
    const p1_0 = sw1.ports[0];
    const p2_0 = sw2.ports[0];

    // Configure SW1 Gi1/0/1 as Dynamic Auto
    useNetworkStore.getState().updateDevice(sw1.id, {
        ports: sw1.ports.map(p => p.id === p1_0.id ? { ...p, mode: 'dynamic', dtpMode: 'dynamic-auto' } : p)
    });
    // Configure SW2 Gi1/0/1 as Dynamic Auto
    useNetworkStore.getState().updateDevice(sw2.id, {
        ports: sw2.ports.map(p => p.id === p2_0.id ? { ...p, mode: 'dynamic', dtpMode: 'dynamic-auto' } : p)
    });

    // Connect
    useNetworkStore.getState().connectPorts(sw1.id, p1_0.id, sw2.id, p2_0.id);

    // Check results
    const p1_res = getPort(sw1.id, 0);
    const p2_res = getPort(sw2.id, 0);

    console.log(`SW1 Port Mode: ${p1_res.mode} (Expected: access)`);
    console.log(`SW2 Port Mode: ${p2_res.mode} (Expected: access)`);

    if (p1_res.mode === 'access' && p2_res.mode === 'access') {
        console.log("PASS: Auto-Auto resolved to Access.");
    } else {
        console.error("FAIL: Auto-Auto mismatch.");
    }

    // Case 2: Desirable - Auto (Expect: Trunk)
    console.log("\n[Test 2] Desirable - Auto");
    const p2_1 = sw2.ports[1]; // SW2 second port
    const p3_0 = sw3.ports[0]; // SW3 first port

    // Configure SW2 Gi1/0/2 as Dynamic Desirable
    useNetworkStore.getState().updateDevice(sw2.id, {
        ports: sw2.ports.map(p => p.id === p2_1.id ? { ...p, mode: 'dynamic', dtpMode: 'dynamic-desirable' } : p)
    });
    // Configure SW3 Gi1/0/1 as Dynamic Auto
    useNetworkStore.getState().updateDevice(sw3.id, {
        ports: sw3.ports.map(p => p.id === p3_0.id ? { ...p, mode: 'dynamic', dtpMode: 'dynamic-auto' } : p)
    });

    // Connect
    useNetworkStore.getState().connectPorts(sw2.id, p2_1.id, sw3.id, p3_0.id);

    const p2_1_res = getPort(sw2.id, 1);
    const p3_res = getPort(sw3.id, 0);

    console.log(`SW2 Port Mode: ${p2_1_res.mode} (Expected: trunk)`);
    console.log(`SW3 Port Mode: ${p3_res.mode} (Expected: trunk)`);

    if (p2_1_res.mode === 'trunk' && p3_res.mode === 'trunk') {
        console.log("PASS: Desirable-Auto resolved to Trunk.");
    } else {
        console.error("FAIL: Desirable-Auto mismatch.");
    }

    console.log("=== Done ===");
};

runTest();
