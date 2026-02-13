/**
 * ネットワーク接続性エンジン
 * Ping/Tracerouteのための実際のトポロジー解析と経路探索
 * VLAN, Trunk, EtherChannel, L3ルーティングを考慮
 */

import { Device, PC, L2Switch, L3Switch, Connection, Port, HsrpState, AccessList, AccessListEntry, ArpEntry } from '@/stores/types';

// IPアドレスをサブネット計算用の数値に変換
function ipToNumber(ip: string): number {
    const parts = ip.split('.').map(Number);
    return (parts[0] << 24) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
}

// 同一サブネット判定
function isSameSubnet(ip1: string, ip2: string, mask: string): boolean {
    const maskNum = ipToNumber(mask);
    const ip1Num = ipToNumber(ip1);
    const ip2Num = ipToNumber(ip2);
    return (ip1Num & maskNum) === (ip2Num & maskNum);
}

// IP Match Helper (Wildcard: 0=Match, 1=Ignore)
function isIpMatch(ip: string, patternIp: string, wildcard: string): boolean {
    const ipNum = ipToNumber(ip);
    const patternNum = ipToNumber(patternIp);
    const wildNum = ipToNumber(wildcard);
    return (ipNum & ~wildNum) === (patternNum & ~wildNum);
}

// ACL Check Logic
function checkAccessList(acl: AccessList, srcIp: string, dstIp: string, protocol: string): 'permit' | 'deny' {
    for (const entry of acl.entries) {
        let match = true;

        if (acl.type === 'standard') {
            if (entry.sourceIp && entry.sourceWildcard) {
                if (!isIpMatch(srcIp, entry.sourceIp, entry.sourceWildcard)) match = false;
            }
        } else {
            // Extended
            if (entry.protocol && entry.protocol !== 'ip') {
                if (entry.protocol !== protocol) match = false;
            }
            if (match && entry.sourceIp && entry.sourceWildcard) {
                if (!isIpMatch(srcIp, entry.sourceIp, entry.sourceWildcard)) match = false;
            }
            if (match && entry.destinationIp && entry.destinationWildcard) {
                if (!isIpMatch(dstIp, entry.destinationIp, entry.destinationWildcard)) match = false;
            }
        }

        if (match) return entry.action;
    }
    return 'deny'; // Implicit deny
}

interface PacketContext {
    srcIp: string;
    dstIp: string;
    protocol: 'icmp' | 'tcp' | 'udp' | 'ip';
}

// Ping結果
export interface PingResult {
    success: boolean;
    reachable: boolean;
    hops: string[];
    rtt: number[];
    errors: string[];
    arpUpdates?: { deviceId: string; entry: ArpEntry }[]; // Added
}

// Traceroute結果
export interface TracerouteResult {
    success: boolean;
    hops: {
        hop: number;
        ip: string;
        hostname: string;
        rtt: number;
    }[];
    destination: string;
    errors: string[];
}

// トポロジーグラフのノード
interface TopologyNode {
    deviceId: string;
    device: Device;
    neighbors: {
        deviceId: string;
        port: Port;       // 出力物理ポート
        neighborPort: Port; // 入力物理ポート
    }[];
}

interface PathState {
    deviceId: string;
    path: string[];
    currentVlanId: number | undefined; // undefined = Untagged/Native outside switch logic
}

/**
 * 接続性エンジンクラス
 */
export class ConnectivityEngine {
    private devices: Device[];
    private connections: Connection[];
    private graph: Map<string, TopologyNode>;

    constructor(devices: Device[], connections: Connection[]) {
        this.devices = devices;
        this.connections = connections;
        this.graph = this.buildTopologyGraph();
    }

    // トポロジーグラフを構築
    private buildTopologyGraph(): Map<string, TopologyNode> {
        const graph = new Map<string, TopologyNode>();

        // 全デバイスをノードとして追加
        for (const device of this.devices) {
            graph.set(device.id, {
                deviceId: device.id,
                device,
                neighbors: [],
            });
        }

        // 接続を辺として追加
        // EtherChannelの場合は物理リンクごとに近隣関係を追加し、経路探索時に論理的に処理する
        for (const conn of this.connections) {
            if (conn.status !== 'up') continue;

            const sourceNode = graph.get(conn.sourceDeviceId);
            const targetNode = graph.get(conn.targetDeviceId);

            if (sourceNode && targetNode) {
                const sourceDevice = this.devices.find(d => d.id === conn.sourceDeviceId);
                const targetDevice = this.devices.find(d => d.id === conn.targetDeviceId);

                const sourcePort = sourceDevice?.ports.find(p => p.id === conn.sourcePortId);
                const targetPort = targetDevice?.ports.find(p => p.id === conn.targetPortId);

                // 物理ポートがUPであることを確認
                // (EtherChannel構成でも物理リンクUPが必要)
                if (sourcePort?.status === 'up' && targetPort?.status === 'up') {
                    sourceNode.neighbors.push({
                        deviceId: conn.targetDeviceId,
                        port: sourcePort,
                        neighborPort: targetPort,
                    });

                    targetNode.neighbors.push({
                        deviceId: conn.sourceDeviceId,
                        port: targetPort,
                        neighborPort: sourcePort,
                    });
                }
            }
        }

        return graph;
    }

    private getDevice(deviceId: string): Device | undefined {
        return this.devices.find(d => d.id === deviceId);
    }

    private findDeviceByIp(ip: string): Device | undefined {
        for (const device of this.devices) {
            if (device.type === 'pc' && (device as PC).ipAddress === ip) {
                return device;
            }
            if (device.type === 'l3-switch') {
                const l3 = device as L3Switch;
                // Check HSRP VIPs
                if (l3.hsrpGroups.some(h => h.virtualIp === ip)) {
                    return device;
                }
                // Check Routed Ports
                for (const port of l3.ports) {
                    if (port.mode === 'routed' && port.ipAddress === ip) {
                        return device;
                    }
                }
                // Check SVI (Interface Vlan) - strictly mostly simulated by HSRP VIP in this app, 
                // but if we implemented real SVIs in future, check them here. 
                // For now, check if "VLAN matches SVI IP" which isn't fully in types yet (only SVI Vlan1 default).
            }
        }
        return undefined;
    }

    private findGateway(gatewayIp: string): Device | undefined {
        // Find device that owns this IP (HSRP VIP or Routed Port IP)
        return this.findDeviceByIp(gatewayIp);
    }

    private getEffectivePort(device: Device, port: Port): Port {
        if ((device.type === 'l2-switch' || device.type === 'l3-switch') && port.channelGroup) {
            const sw = device as L2Switch | L3Switch;
            const poName = `Po${port.channelGroup}`;
            const poPort = sw.ports.find(p => p.name === poName || p.name === `Port-channel${port.channelGroup}`);

            if (poPort) {
                return {
                    ...poPort,
                    id: port.id,
                    name: `${port.name}(${poName})`,
                    status: port.status,
                    mode: poPort.mode,
                    vlan: poPort.vlan,
                    trunkAllowedVlans: poPort.trunkAllowedVlans,
                    ipAddress: poPort.ipAddress, // Routed EtherChannel support
                    subnetMask: poPort.subnetMask,
                };
            }
        }
        return port;
    }

    private findPath(sourceId: string, targetId: string, startVlanId?: number, packetContext?: PacketContext): string[] | null {
        const visited = new Set<string>();
        // allow startVlanId = -1 to denote "routed port context" (strictly L3) if needed, 
        // but undefined (untagged) is sufficient for routed ports.

        const queue: PathState[] = [{
            deviceId: sourceId,
            path: [sourceId],
            currentVlanId: startVlanId
        }];

        while (queue.length > 0) {
            const current = queue.shift()!;

            if (current.deviceId === targetId) {
                return current.path;
            }

            const stateKey = `${current.deviceId}:${current.currentVlanId ?? 'u'}`;
            if (visited.has(stateKey)) continue;
            visited.add(stateKey);

            const node = this.graph.get(current.deviceId);
            if (!node) continue;

            const currentNodeDeviceType = node.device.type;

            for (const neighbor of node.neighbors) {
                const nextDeviceId = neighbor.deviceId;
                const nextNode = this.graph.get(nextDeviceId);
                if (!nextNode) continue;

                const outboundPort = this.getEffectivePort(node.device, neighbor.port);
                const inboundPort = this.getEffectivePort(nextNode.device, neighbor.neighborPort);

                // --- 0. STP Check (Egress) ---
                if (node.device.type === 'l2-switch' || node.device.type === 'l3-switch') {
                    const sw = node.device as L2Switch | L3Switch;
                    const stpState = sw.stpState?.portStates?.[outboundPort.id]; // Optional chain for safety
                    // If defined and NOT forwarding, block. (Assume Forwarding if undefined or 'disabled' handled elsewhere)
                    // Note: 'disabled' logic handled by port status check generally, but STP disabled port is also blocking.
                    if (stpState && stpState !== 'forwarding') {
                        continue; // Blocked by STP
                    }
                }

                // --- 0.5 ACL Check (Egress & Ingress) ---
                if (packetContext) {
                    const { srcIp, dstIp, protocol } = packetContext;

                    // Egress Check (Current Node)
                    if (node.device.type === 'l3-switch') {
                        const sw = node.device as L3Switch;
                        if (outboundPort.accessGroupOut) {
                            const acl = sw.accessLists?.find(a => a.id === outboundPort.accessGroupOut);
                            if (acl) {
                                if (checkAccessList(acl, srcIp, dstIp, protocol) === 'deny') continue;
                            }
                        }
                    }

                    // Ingress Check (Next Node)
                    if (nextNode.device.type === 'l3-switch') {
                        const sw = nextNode.device as L3Switch;
                        if (inboundPort.accessGroupIn) {
                            const acl = sw.accessLists?.find(a => a.id === inboundPort.accessGroupIn);
                            if (acl) {
                                if (checkAccessList(acl, srcIp, dstIp, protocol) === 'deny') continue;
                            }
                        }
                    }
                }

                // --- 1. Egress Check ---
                let wireVlanId: number | undefined;
                let egressAllowed = true;

                if (currentNodeDeviceType === 'pc') {
                    wireVlanId = undefined;
                } else {
                    // Routed Port Egress
                    if (outboundPort.mode === 'routed') {
                        // Always untagged. Allowed if we are originating here (L3 hop) 
                        // or if we somehow entered connection logic. 
                        // For now, assume routed ports send untagged.
                        wireVlanId = undefined;
                    }
                    // Switch L2 Logic
                    else if (current.currentVlanId === undefined) {
                        // Case: L3 switch routing to L2 port handled by upper logic? 
                        // If we are "undefined" context inside switch, we can only exit via routed port (handled above) 
                        // or Access port if we treat undefined as "internal default"? 
                        // Ideally, routing logic converts IP->VLAN. 
                        // If we are here with undefined from L3SW source pinging via routed port:
                        wireVlanId = undefined;
                    } else {
                        // Access Port
                        if (outboundPort.mode === 'access') {
                            if (outboundPort.vlan === current.currentVlanId) {
                                wireVlanId = undefined;
                            } else {
                                egressAllowed = false;
                            }
                        }
                        // Trunk Port
                        else if (outboundPort.mode === 'trunk') {
                            const allowed = !outboundPort.trunkAllowedVlans || outboundPort.trunkAllowedVlans.length === 0 || outboundPort.trunkAllowedVlans.includes(current.currentVlanId);
                            if (allowed) {
                                const nativeVlan = 1;
                                if (current.currentVlanId === nativeVlan) {
                                    wireVlanId = undefined;
                                } else {
                                    wireVlanId = current.currentVlanId;
                                }
                            } else {
                                egressAllowed = false;
                            }
                        } else {
                            // Dynamic/Unconfigured -> default Access vlan 1
                            if (current.currentVlanId === 1) wireVlanId = undefined;
                            else egressAllowed = false;
                        }
                    }
                }

                if (!egressAllowed) continue;

                // --- 2. Ingress Check ---
                let nextVlanId: number | undefined;
                const nextDeviceType = nextNode.device.type;
                let ingressAllowed = true;

                if (nextDeviceType === 'pc') {
                    if (wireVlanId !== undefined) ingressAllowed = false;
                    nextVlanId = undefined;
                } else {
                    // Switch or Router
                    // Routed Port Ingress (Treat as L3 endpoint effectively)
                    if (inboundPort.mode === 'routed') {
                        if (wireVlanId !== undefined) ingressAllowed = false; // Routed expects untagged
                        nextVlanId = undefined; // Stays "L3" (undefined vlan)
                    }
                    // Access Port Ingress
                    else if (inboundPort.mode === 'access') {
                        if (wireVlanId === undefined) {
                            nextVlanId = inboundPort.vlan || 1;
                        } else {
                            ingressAllowed = false;
                        }
                    }
                    // Trunk Port Ingress
                    else if (inboundPort.mode === 'trunk') {
                        const nativeVlan = 1;
                        if (wireVlanId === undefined) {
                            nextVlanId = nativeVlan;
                        } else {
                            nextVlanId = wireVlanId;
                        }
                        const allowed = !inboundPort.trunkAllowedVlans || inboundPort.trunkAllowedVlans.length === 0 || inboundPort.trunkAllowedVlans.includes(nextVlanId);
                        if (!allowed) ingressAllowed = false;
                    }
                    else {
                        // Default Access Vlan 1
                        if (wireVlanId === undefined) nextVlanId = 1;
                        else ingressAllowed = false;
                    }
                }

                if (!ingressAllowed) continue;

                queue.push({
                    deviceId: nextDeviceId,
                    path: [...current.path, nextDeviceId],
                    currentVlanId: nextVlanId
                });
            }
        }
        return null;
    }

    /**
     * Determine egress context (VLAN ID or Routed interface) for L3 switching.
     * Returns number for VLAN ID, undefined for Routed Port (implies direct egress).
     */
    private findEgressContext(l3: L3Switch, targetIp: string): number | undefined {
        // 1. Check Connected Routes (SVI) via HSRP
        for (const grp of l3.hsrpGroups) {
            if (isSameSubnet(grp.virtualIp, targetIp, '255.255.255.0')) {
                return grp.group; // Return VLAN ID
            }
        }
        // 2. Check Routed Ports
        for (const port of l3.ports) {
            if (port.mode === 'routed' && port.ipAddress && port.subnetMask) {
                if (isSameSubnet(port.ipAddress, targetIp, port.subnetMask)) {
                    return undefined; // Indicates routed port context (no VLAN)
                }
            }
        }
        return undefined; // Default / fallback
    }

    ping(sourceDeviceId: string, targetIp: string): PingResult {
        const sourceDevice = this.getDevice(sourceDeviceId);
        if (!sourceDevice) return { success: false, reachable: false, hops: [], rtt: [], errors: ['Source not found'] };

        const targetDevice = this.findDeviceByIp(targetIp);

        // --- PC ping Logic ---
        if (sourceDevice.type === 'pc') {
            const pc = sourceDevice as PC;
            if (!pc.ipAddress) return { success: false, reachable: false, hops: [], rtt: [], errors: ['No IP'] };
            if (pc.ipAddress === targetIp) return { success: true, reachable: true, hops: ['localhost'], rtt: [0], errors: [] };

            const packetContext: PacketContext = {
                srcIp: pc.ipAddress,
                dstIp: targetIp,
                protocol: 'icmp'
            };

            // L2 Reachability
            if (isSameSubnet(pc.ipAddress, targetIp, pc.subnetMask)) {
                if (!targetDevice) return { success: true, reachable: false, hops: [], rtt: [], errors: ['Destination Unreachable'] };
                const path = this.findPath(sourceDeviceId, targetDevice.id, undefined, packetContext);
                return path
                    ? { success: true, reachable: true, hops: path.map(id => this.getDevice(id)?.hostname || id), rtt: [1, 1, 1, 1, 1], errors: [] }
                    : { success: true, reachable: false, hops: [], rtt: [], errors: ['Destination Unreachable'] };
            }

            // L3 Reachability (via Gateway)
            if (!pc.defaultGateway) return { success: true, reachable: false, hops: [], rtt: [], errors: ['No Gateway'] };
            const gateway = this.findGateway(pc.defaultGateway);
            if (!gateway) return { success: true, reachable: false, hops: [], rtt: [], errors: ['Gateway Unreachable'] };

            // Path to Gateway
            const pathToGw = this.findPath(sourceDeviceId, gateway.id, undefined, packetContext);
            if (!pathToGw) return { success: true, reachable: false, hops: [], rtt: [], errors: ['Gateway Unreachable'] };

            // Gateway routing
            if (targetDevice) {
                // Gateway (L3) to Target
                // If Target is connected to Gateway directly (SVI or Routed Port)
                // Determine Egress Context
                if (gateway.type === 'l3-switch') {
                    // Check if gateway knows target subnet
                    const egressContext = this.findEgressContext(gateway as L3Switch, targetIp);
                    // findPath starting from Gateway with egressContext
                    // If egressContext is undefined, it might mean routed port OR failure.
                    // We just need to ensure startVlanId is respected in findPath. 
                    const pathFromGw = this.findPath(gateway.id, targetDevice.id, egressContext, packetContext);

                    if (pathFromGw) {
                        const path = [...new Set([...pathToGw, ...pathFromGw])];
                        return { success: true, reachable: true, hops: path.map(id => this.getDevice(id)?.hostname || id), rtt: [5, 5, 5, 5], errors: [] };
                    }
                }
            }

            return { success: true, reachable: false, hops: [], rtt: [], errors: ['Destination Unreachable'] };
        }

        // --- L3 Switch Ping Logic ---
        if (sourceDevice.type === 'l3-switch') {
            if (!targetDevice) return { success: true, reachable: false, hops: [], rtt: [], errors: ['Destination Unreachable'] };

            // Determine Source IP for ACL check
            const l3 = sourceDevice as L3Switch;
            const routedPort = l3.ports.find(p => p.mode === 'routed' && p.ipAddress);
            // Theoretically we should check which interface is used for egress, but simplifying:
            const sourceIp = routedPort?.ipAddress || '0.0.0.0';

            const packetContext: PacketContext = {
                srcIp: sourceIp,
                dstIp: targetIp,
                protocol: 'icmp'
            };

            const egressContext = this.findEgressContext(sourceDevice as L3Switch, targetIp);

            // ARP Check Logic
            const srcL3 = sourceDevice as L3Switch;
            // Determine ARP Target IP (Direct destination or Next Hop)
            // Ideally we check routing table for Next Hop.
            // Simplified: If same subnet as any interface, ARP for targetIp.
            // Else, look for route.

            // Checking Connected Subnets
            let arpTargetIp: string | null = null;
            let outgoingInterface: string = 'unknown';

            // Check Connected SVI/RoutedPorts
            let isConnected = false;
            for (const h of srcL3.hsrpGroups) {
                if (isSameSubnet(h.virtualIp, targetIp, '255.255.255.0')) {
                    isConnected = true;
                    outgoingInterface = `Vlan${h.group}`;
                    break;
                }
            }
            if (!isConnected) {
                for (const p of srcL3.ports) {
                    if (p.mode === 'routed' && p.ipAddress && p.subnetMask) {
                        if (isSameSubnet(p.ipAddress, targetIp, p.subnetMask)) {
                            isConnected = true;
                            outgoingInterface = p.name;
                            break;
                        }
                    }
                }
            }

            if (isConnected) {
                arpTargetIp = targetIp;
            } else {
                // Routing Lookup needed to find Next Hop
                // Skip for now or assume Default Gateway if exists?
                // If simple Ping to connected host, isConnected is true.
            }

            if (arpTargetIp) {
                const hasArp = srcL3.arpTable.some(e => e.ipAddress === arpTargetIp);
                if (!hasArp && targetDevice) {
                    // ARP Miss -> Return Timeout BUT provide ARP update for next time
                    let targetMac = '';
                    if (targetDevice.type === 'l2-switch' || targetDevice.type === 'l3-switch') targetMac = (targetDevice as L2Switch | L3Switch).macAddress;
                    else if (targetDevice.type === 'pc') targetMac = (targetDevice as PC).macAddress;

                    if (targetMac) {
                        return {
                            success: true,
                            reachable: false, // Timeout
                            hops: [],
                            rtt: [],
                            errors: ['Request timed out.'],
                            arpUpdates: [{
                                deviceId: sourceDeviceId,
                                entry: {
                                    ipAddress: arpTargetIp,
                                    macAddress: targetMac,
                                    interface: outgoingInterface,
                                    age: 0
                                }
                            }]
                        };
                    }
                }
            }

            const path = this.findPath(sourceDeviceId, targetDevice.id, egressContext, packetContext);
            return path
                ? { success: true, reachable: true, hops: path.map(id => this.getDevice(id)?.hostname || id), rtt: [1, 1, 1, 1, 1], errors: [] }
                : { success: true, reachable: false, hops: [], rtt: [], errors: ['Destination Unreachable'] };
        }

        return { success: false, reachable: false, hops: [], rtt: [], errors: ['Unsupported device'] };
    }

    // Traceroute (Pingと同様のロジックで各ホップを返すため、簡易的に既存ロジックを流用しつつfindPathの更新を反映)
    traceroute(sourceDeviceId: string, targetIp: string): TracerouteResult {
        // NOTE: Tracerouteの完全なVLAN対応版はPingロジックと重複するため
        // 簡略化してPingが成功するかどうかで判定も可能だが、
        // ここではエラーを返すだけにするか、Pingを呼んでエミュレートする
        // 今回はPingの実装を優先し、TracerouteはPingの結果を利用して擬似的に返す

        const pingRes = this.ping(sourceDeviceId, targetIp);
        if (!pingRes.success || !pingRes.reachable) {
            return { success: false, hops: [], destination: targetIp, errors: pingRes.errors };
        }

        // Hopsの構築 (Simple emulation)
        const hops = pingRes.hops.map((hostname, idx) => ({
            hop: idx + 1,
            ip: 'unknown', // IP解決は手間なので省略
            hostname: hostname,
            rtt: pingRes.rtt[0] || 1
        }));

        return { success: true, hops, destination: targetIp, errors: [] };
    }
}

export function checkConnectivity(
    devices: Device[],
    connections: Connection[],
    sourceDeviceId: string,
    targetIp: string
): PingResult {
    const engine = new ConnectivityEngine(devices, connections);
    return engine.ping(sourceDeviceId, targetIp);
}

export function traceRoute(
    devices: Device[],
    connections: Connection[],
    sourceDeviceId: string,
    targetIp: string
): TracerouteResult {
    const engine = new ConnectivityEngine(devices, connections);
    // Ping成功なら擬似的なTraceroute成功を返す
    return engine.traceroute(sourceDeviceId, targetIp);
}
