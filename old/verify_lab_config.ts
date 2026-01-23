
import { createL3Switch, createPC } from '../src/stores/useNetworkStore';
import { processCliCommand, CommandContext } from '../src/lib/cliParser';
import { Device, L3Switch } from '../src/stores/types';

// Mock helper
const execCmd = (cmd: string, ctx: CommandContext) => {
    console.log(`\nCMD: ${cmd}`);
    const res = processCliCommand(cmd, ctx);
    if (res.output && res.output.length > 0) console.log(res.output.join('\n'));

    if (res.updateConfig) {
        Object.assign(ctx.device, res.updateConfig);
        // Special Handling for Array merging if mostly replacing
        if (res.updateConfig.ports) ctx.device.ports = res.updateConfig.ports;
        if (res.updateConfig.hsrpGroups) (ctx.device as L3Switch).hsrpGroups = res.updateConfig.hsrpGroups;
    }
    if (res.newMode) ctx.mode = res.newMode;
    if (res.newInterface) ctx.currentInterface = res.newInterface;
    if (res.selectedPortIds) ctx.selectedPortIds = res.selectedPortIds;
    return res;
};

const runTest = () => {
    console.log("=== Starting Lab Config Verification (SVI, HSRP) ===");

    // Setup L3 Switch
    const sw1 = createL3Switch('DSW1', { x: 0, y: 0 });
    const ctx: CommandContext = {
        device: sw1,
        mode: 'global-config',
        updateDevice: () => { },
        allDevices: [sw1],
        allConnections: []
    };

    // 1. SVI Creation
    console.log("\n[Test 1] SVI (Interface Vlan) Creation");
    execCmd("interface vlan 10", ctx);

    const svi = sw1.ports.find(p => p.name === 'Vlan10');
    if (svi) {
        console.log("PASS: SVI 'Vlan10' created.");
    } else {
        console.error("FAIL: SVI 'Vlan10' not found.");
    }

    // 2. IP Address on SVI
    console.log("\n[Test 2] IP Address on SVI");
    if (svi) {
        // Need to ensure context interface is "Vlan10"
        ctx.currentInterface = 'Vlan10';
        execCmd("ip address 192.168.10.2 255.255.255.0", ctx);

        // Refresh ref
        const sviUpdated = sw1.ports.find(p => p.name === 'Vlan10');
        if (sviUpdated?.ipAddress === '192.168.10.2') {
            console.log("PASS: IP address assigned to SVI.");
        } else {
            console.error("FAIL: SVI IP mismatch", sviUpdated?.ipAddress);
        }
    }

    // 3. HSRP Configuration
    console.log("\n[Test 3] HSRP Configuration");
    execCmd("standby 10 ip 192.168.10.1", ctx);
    execCmd("standby 10 priority 150", ctx);
    execCmd("standby 10 preempt", ctx);

    const group = sw1.hsrpGroups.find(g => g.group === 10);
    if (group && group.virtualIp === '192.168.10.1' && group.priority === 150 && group.preempt) {
        console.log("PASS: HSRP Group 10 configured correctly.");
    } else {
        console.error("FAIL: HSRP config mismatch", group);
    }

    // 4. Show Standby
    console.log("\n[Test 4] Show Standby");
    // Switch to privileged mode mock
    ctx.mode = 'privileged';
    const res = execCmd("show standby brief", ctx);
    if (res.output.some(l => l.includes("Vlan10") && l.includes("150") && l.includes("P"))) {
        console.log("PASS: 'show standby' output correct.");
    } else {
        console.error("FAIL: 'show standby' output missing info.");
    }

    console.log("=== Done ===");
};

runTest();
