
import { createL2Switch, useNetworkStore } from '../src/stores/useNetworkStore';
import { processCliCommand, CommandContext } from '../src/lib/cliParser';

const runTest = () => {
    console.log("=== Starting Config Save/Reload Verification ===");

    // 1. Setup Device
    const sw = createL2Switch('SW1', { x: 0, y: 0 });
    // Initial config should match startup
    console.log(`[Test 1] Initial Config Check`);
    if (JSON.stringify(sw.runningConfig) === JSON.stringify(sw.startupConfig)) {
        console.log("PASS: Initial running-config matches startup-config.");
    } else {
        console.error("FAIL: Initial config mismatch.");
    }

    useNetworkStore.setState({
        devices: [sw],
        connections: [],
        selectedDeviceId: null,
        terminalStates: {}
    });

    const ctx: CommandContext = {
        device: sw,
        mode: 'privileged',
        updateDevice: (id, updates) => useNetworkStore.getState().updateDevice(id, updates),
        allDevices: [sw],
        allConnections: []
    };

    // Helper to simulate store update via CLI result
    const runCmd = (cmd: string) => {
        console.log(`\nCMD: ${cmd}`);
        const res = processCliCommand(cmd, ctx);
        console.log("Output:", res.output.join(' | '));
        if (res.updateConfig) {
            useNetworkStore.getState().updateDevice(sw.id, res.updateConfig);
            // Updating local reference for checking
            Object.assign(sw, res.updateConfig);
        }
        return res;
    };

    // 2. Modify Running Config
    console.log("\n[Test 2] Modifying Config (hostname Changed)");
    // Manually push to running config to simulate change (since we don't have full 'hostname' command parser verified here yet, assuming direct manipulation or simulating it)
    // Actually we do have hostname command? Let's assume yes or just direct edit.
    // Let's use direct edit for precision.
    const newRunConfig = [...sw.runningConfig, 'hostname Changed-SW'];
    useNetworkStore.getState().updateDevice(sw.id, { runningConfig: newRunConfig });
    sw.runningConfig = newRunConfig;

    console.log("Running Config Modified.");

    // 3. Reload WITHOUT Saving
    console.log("\n[Test 3] Reload without write memory");
    runCmd('reload');

    // Check if reverted
    const swReverted = useNetworkStore.getState().devices.find(d => d.id === sw.id)! as typeof sw; // Cast to L2Switch
    if (JSON.stringify(swReverted.runningConfig) === JSON.stringify(swReverted.startupConfig)) {
        console.log("PASS: Running config reverted to startup config after reload.");
        if (swReverted.runningConfig.includes('hostname Changed-SW')) {
            console.error("FAIL: 'hostname Changed-SW' still exists!");
        } else {
            console.log("PASS: 'hostname Changed-SW' is gone.");
        }
    } else {
        console.error("FAIL: Config did not revert correctly.");
    }

    // 4. Modify and Save
    console.log("\n[Test 4] Modify and Write Memory");
    const newRunConfig2 = [...sw.startupConfig, 'hostname Saved-SW']; // Based on clean startup
    useNetworkStore.getState().updateDevice(sw.id, { runningConfig: newRunConfig2 });
    sw.runningConfig = newRunConfig2;
    // Update reference in store

    runCmd('write memory');

    const swSaved = useNetworkStore.getState().devices.find(d => d.id === sw.id)! as typeof sw;

    // Check startup config
    if (JSON.stringify(swSaved.startupConfig) === JSON.stringify(swSaved.runningConfig)) {
        console.log("PASS: Startup config updated to match Running config.");
    } else {
        console.error("FAIL: Startup config was not updated.");
    }

    // 5. Reload AFTER Saving
    console.log("\n[Test 5] Reload after save");
    runCmd('reload');

    const swReloaded = useNetworkStore.getState().devices.find(d => d.id === sw.id)! as typeof sw;
    if (swReloaded.runningConfig.includes('hostname Saved-SW')) {
        console.log("PASS: Configuration persisted after reload.");
    } else {
        console.error("FAIL: Configuration lost after reload (persist failed).");
    }

    console.log("=== Done ===");
};

runTest();
