
import { createL2Switch } from '../src/stores/useNetworkStore';
import { processCliCommand, CommandContext } from '../src/lib/cliParser';
import { Device, L2Switch } from '../src/stores/types';

// Mock helper
const execCmd = (cmd: string, ctx: CommandContext) => {
    console.log(`\nCMD: ${cmd}`);
    const res = processCliCommand(cmd, ctx);
    if (res.output && res.output.length > 0) console.log(res.output.join('\n'));

    if (res.updateConfig) {
        Object.assign(ctx.device, res.updateConfig);
        // Deep merge for stpState if necessary, but simple assignment of stpState is usually done in parser
        //Parser returns full new stpState object usually
        if ((res.updateConfig as any).stpState) (ctx.device as any).stpState = (res.updateConfig as any).stpState;
    }
    return res;
};

const runTest = () => {
    console.log("=== Starting Lab Config V2 Verification (STP) ===");

    // SCENARIO: DSW1 Config
    const sw1 = createL2Switch('DSW1', { x: 0, y: 0 });
    // Mock Vlans
    sw1.vlanDb.push({ id: 10, name: 'VLAN0010', status: 'active' });
    sw1.vlanDb.push({ id: 20, name: 'VLAN0020', status: 'active' });

    const ctx: CommandContext = {
        device: sw1,
        mode: 'global-config',
        updateDevice: () => { },
        allDevices: [sw1],
        allConnections: []
    };

    // 1. Root Primary
    console.log("\n[Test 1] STP Root Primary (Vlan 10)");
    execCmd("spanning-tree vlan 10 root primary", ctx);

    const v10Config = sw1.stpState.vlanConfig?.[10];
    if (v10Config?.priority === 24576 && v10Config.rootType === 'primary') {
        console.log("PASS: Vlan 10 priority set to 24576 (primary).");
    } else {
        console.error("FAIL: Vlan 10 config mismatch", v10Config);
    }

    // 2. Root Secondary
    console.log("\n[Test 2] STP Root Secondary (Vlan 20)");
    execCmd("spanning-tree vlan 20 root secondary", ctx);

    const v20Config = sw1.stpState.vlanConfig?.[20];
    if (v20Config?.priority === 28672 && v20Config.rootType === 'secondary') {
        console.log("PASS: Vlan 20 priority set to 28672 (secondary).");
    } else {
        console.error("FAIL: Vlan 20 config mismatch", v20Config);
    }

    // 3. Manual Priority
    console.log("\n[Test 3] STP Manual Priority (Vlan 10 -> 4096)");
    execCmd("spanning-tree vlan 10 priority 4096", ctx);

    const v10ConfigNew = sw1.stpState.vlanConfig?.[10];
    if (v10ConfigNew?.priority === 4096) {
        console.log("PASS: Vlan 10 priority updated to 4096 manually.");
    } else {
        console.error("FAIL: Vlan 10 priority mismatch", v10ConfigNew);
    }

    // 4. Show Spanning-Tree
    console.log("\n[Test 4] Show Spanning-Tree");
    ctx.mode = 'privileged';
    const res = execCmd("show spanning-tree", ctx);

    const output = res.output.join('\n');
    if (output.includes("VLAN0010") && output.includes("Priority    4096") &&
        output.includes("VLAN0020") && output.includes("Priority    28672")) {
        console.log("PASS: 'show spanning-tree' displays correct info for multiple VLANs.");
    } else {
        console.error("FAIL: 'show spanning-tree' output incorrect.\n", output);
    }

    console.log("=== Done ===");
};

runTest();
