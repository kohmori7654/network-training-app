
import { createL3Switch } from '../src/stores/useNetworkStore';
import { processCliCommand, CommandContext } from '../src/lib/cliParser';

const exec = (cmd: string, ctx: CommandContext) => {
    console.log(`\nCMD: ${cmd}`);
    const res = processCliCommand(cmd, ctx);
    console.log(res.output.join('\n'));
    return res;
};

const runTest = () => {
    console.log("=== Starting Show Command Verification ===");

    const sw = createL3Switch('SW1', { x: 0, y: 0 });

    // Mock Data
    sw.routingTable = [
        { protocol: 'connected', network: '10.1.1.0', mask: '255.255.255.0', nextHop: '0.0.0.0', interface: 'Gi1/0/1', metric: 0 },
        { protocol: 'ospf', network: '192.168.2.0', mask: '255.255.255.0', nextHop: '10.1.1.2', interface: 'Gi1/0/1', metric: 20 }
    ];
    sw.accessLists = [{
        id: 101,
        type: 'extended',
        entries: [
            { sequence: 10, action: 'permit', protocol: 'icmp', sourceIp: '10.1.1.0', sourceWildcard: '0.0.0.255', destinationIp: 'any', destinationWildcard: '' }
        ]
    }];

    const ctx: CommandContext = {
        device: sw,
        mode: 'privileged',
        updateDevice: () => { },
        allDevices: [sw],
        allConnections: []
    };

    // 1. Show IP Route
    console.log("\n[Test 1] show ip route");
    const res1 = exec("show ip route", ctx);
    if (res1.output.some(l => l.includes('192.168.2.0')) && res1.output.some(l => l.includes('10.1.1.0'))) {
        console.log("PASS: show ip route displays both connected and OSPF routes.");
    } else {
        console.error("FAIL: show ip route output missing routes.");
    }

    // 2. Show Access-Lists
    console.log("\n[Test 2] show access-lists");
    const res2 = exec("show access-lists", ctx);
    if (res2.output.some(l => l.includes('Extended IP access list 101')) && res2.output.some(l => l.includes('permit icmp 10.1.1.0 0.0.0.255 any'))) {
        console.log("PASS: show access-lists displays correctly.");
    } else {
        console.error("FAIL: show access-lists output mismatch.");
    }

    // 3. Show IP Interface Brief
    console.log("\n[Test 3] show ip interface brief");
    // Gi1/0/1 に IP を設定
    sw.ports[0].ipAddress = '10.1.1.254';
    sw.ports[0].mode = 'routed';
    const res3 = exec("show ip interface brief", ctx);
    if (res3.output.some(l => l.includes('Gi1/0/1') && l.includes('10.1.1.254'))) {
        console.log("PASS: show ip interface brief displays IP address.");
    } else {
        console.error("FAIL: show ip interface brief missing IP info.");
    }

    console.log("=== Done ===");
};

runTest();
