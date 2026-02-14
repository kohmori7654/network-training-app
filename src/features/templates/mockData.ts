
import { NetworkTemplate } from './types';

// Mock Initial Data: Official Templates
export const OFFICIAL_TEMPLATES: NetworkTemplate[] = [
    {
        id: 'tmpl-official-001',
        slug: 'basic-star-topology',
        name: '基本スター型トポロジ',
        description: 'L2スイッチ1台を中心に、2台のPCを接続したシンプルなネットワーク構成です。',
        isOfficial: true,
        author: 'System',
        authorId: 'system',
        createdAt: 1769212800000, // 2026/01/24
        data: JSON.stringify({
            "devices": [
                {
                    "type": "l2-switch",
                    "id": "sw1",
                    "name": "Switch1",
                    "hostname": "Switch1",
                    "position": { "x": 400, "y": 300 },
                    "ports": Array.from({ length: 24 }, (_, i) => ({
                        id: `p${i + 1}`,
                        name: `GigabitEthernet1/0/${i + 1}`,
                        status: i < 2 ? 'up' : 'down',
                        connectedTo: i === 0 ? 'pc1-eth0' : (i === 1 ? 'pc2-eth0' : undefined), // Link to PCs
                        mode: 'access',
                        vlan: 1
                    })),
                    "vlanDb": [{ "id": 1, "name": "default", "status": "active" }],
                    "macAddressTable": [],
                    "stpState": { "mode": "pvst", "priority": 32768, "portStates": {} },
                    "macAddress": "00:00:00:AA:BB:CC",
                    "model": "Catalyst 2960-X"
                },
                {
                    "type": "pc",
                    "id": "pc1",
                    "name": "PC-A",
                    "hostname": "PC-A",
                    "position": { "x": 200, "y": 500 },
                    "ports": [{ "id": "pc1-eth0", "name": "eth0", "status": "up", "connectedTo": "p1" }],
                    "ipAddress": "192.168.1.10",
                    "subnetMask": "255.255.255.0",
                    "defaultGateway": "192.168.1.1",
                    "macAddress": "00:00:00:11:11:11"
                },
                {
                    "type": "pc",
                    "id": "pc2",
                    "name": "PC-B",
                    "hostname": "PC-B",
                    "position": { "x": 600, "y": 500 },
                    "ports": [{ "id": "pc2-eth0", "name": "eth0", "status": "up", "connectedTo": "p2" }],
                    "ipAddress": "192.168.1.11",
                    "subnetMask": "255.255.255.0",
                    "defaultGateway": "192.168.1.1",
                    "macAddress": "00:00:00:22:22:22"
                }
            ],
            "connections": [
                { "id": "c1", "sourceDeviceId": "sw1", "sourcePortId": "p1", "targetDeviceId": "pc1", "targetPortId": "pc1-eth0", "sourceHandle": "s-left", "targetHandle": "t-top", "status": "up" },
                { "id": "c2", "sourceDeviceId": "sw1", "sourcePortId": "p2", "targetDeviceId": "pc2", "targetPortId": "pc2-eth0", "sourceHandle": "s-right", "targetHandle": "t-top", "status": "up" }
            ]
        })
    }
];
