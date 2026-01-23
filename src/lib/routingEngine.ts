
import { Device, L3Switch, RouteEntry, Connection, Port, OspfConfig, BgpConfig } from '@/stores/types';

// Helper: Check if IP is in network
function isIpInNetwork(ip: string, network: string, mask: string): boolean {
    const ipParts = ip.split('.').map(Number);
    const netParts = network.split('.').map(Number);
    const maskParts = mask.split('.').map(Number);

    for (let i = 0; i < 4; i++) {
        if ((ipParts[i] & maskParts[i]) !== (netParts[i] & maskParts[i])) return false;
    }
    return true;
}

// Helper: Convert wildcard to mask
function wildcardToMask(wildcard: string): string {
    return wildcard.split('.').map(part => 255 - parseInt(part)).join('.');
}

// Helper: Get network address from IP and Mask
function getNetworkAddress(ip: string, mask: string): string {
    const ipParts = ip.split('.').map(Number);
    const maskParts = mask.split('.').map(Number);
    return ipParts.map((p, i) => p & maskParts[i]).join('.');
}

// Type guard
function isL3Switch(device: Device): device is L3Switch {
    return device.type === 'l3-switch';
}

/**
 * Routing Engine
 * Re-calculates routing tables for all L3 devices based on current topology and config.
 * This is a "God View" calculation for simulation purposes.
 */
export function calculateRoutes(devices: Device[], connections: Connection[]): Map<string, RouteEntry[]> {
    const updatedRoutes = new Map<string, RouteEntry[]>();
    const l3Devices = devices.filter(isL3Switch);

    // Initial State: Connected Routes
    l3Devices.forEach(dev => {
        const routes: RouteEntry[] = [];

        // 1. Connected Routes
        dev.ports.forEach(port => {
            if (port.status === 'up' && port.ipAddress && port.subnetMask) {
                const network = getNetworkAddress(port.ipAddress, port.subnetMask);
                routes.push({
                    network,
                    mask: port.subnetMask,
                    nextHop: '0.0.0.0', // Self
                    interface: port.name,
                    metric: 0,
                    protocol: 'connected'
                });
            } else if (port.status === 'up' && port.name.startsWith('Vlan')) {
                // SVI Connected logic (already covered if ipAddress is set on SVI port)
            }
        });

        // 2. Static Routes (Preserve existing if any, manually added via CLI? 
        // For now, assuming parsing handled static routes into routingTable, 
        // but we normally wipe and rebuild dynamic. 
        // Let's assume static routes need to be preserved or re-parsed from config?
        // In this architecture, we might lose "static" if we overwrite.
        // Ideally, we should keep static routes separate or merge.
        // For now, we filter existing static routes and keep them.
        const staticRoutes = dev.routingTable.filter(r => r.protocol === 'static');
        routes.push(...staticRoutes);

        updatedRoutes.set(dev.id, routes);
    });

    // Iterative Convergence (OSPF, BGP, Redistribution)
    let changed = true;
    let iterations = 0;
    const MAX_ITERATIONS = 10;

    while (changed && iterations < MAX_ITERATIONS) {
        changed = false;
        iterations++;

        // Exchange Logic
        for (const dev of l3Devices) {
            const currentRoutes = updatedRoutes.get(dev.id)!;
            const newRoutes: RouteEntry[] = [];

            // --- OSPF Logic ---
            if (dev.ospfConfig) {
                // Find Neighbors
                // Neighbor = Connected L3 Device with OSPF enabled in same area
                // Iterate all ports -> connection -> neighbor

                // For simplicity: Broadcast OSPF to all OSPF-speaking neighbors
                // In reality: Check area match on interface basis

                // Identify OSPF enabled interfaces locally
                const ospfInterfaces = dev.ports.filter(p => {
                    if (!p.ipAddress || !p.subnetMask) return false;
                    return dev.ospfConfig!.networks.some(net =>
                        isIpInNetwork(p.ipAddress!, net.network, wildcardToMask(net.wildcard))
                    );
                });

                for (const myPort of ospfInterfaces) {
                    // Find connected neighbor
                    // This lookup is expensive, maybe optimize?
                    const conn = connections.find(c =>
                        (c.sourceDeviceId === dev.id && c.sourcePortId === myPort.id) ||
                        (c.targetDeviceId === dev.id && c.targetPortId === myPort.id)
                    );
                    if (!conn) continue;

                    const neighborId = conn.sourceDeviceId === dev.id ? conn.targetDeviceId : conn.sourceDeviceId;
                    const neighbor = l3Devices.find(d => d.id === neighborId);

                    if (neighbor && neighbor.ospfConfig) {
                        // Check if neighbor interface is also OSPF enabled? (Implicitly yes if we form adjacency)
                        // Exchange Routes
                        const neighborRoutes = updatedRoutes.get(neighbor.id)!;

                        // Redistribute / Advertise logic
                        // Routes learned by OSPF or Connected/Static/BGP redistributed into OSPF
                        // We filter routes that are eligible for OSPF advertisement

                        for (const r of neighborRoutes) {
                            // Filter loop
                            if (currentRoutes.some(cr => cr.network === r.network && cr.mask === r.mask)) continue;

                            // Eligibility:
                            // 1. Connected (if network command matches) -> Advertised as OSPF (intra-area)
                            // 2. OSPF (learned) -> Propagate
                            // 3. Redistributed (BGP/Static/Connected) -> Advertised as OSPF External

                            let shouldLearn = false;

                            // Simple OSPF: Learn everything from neighbor that is OSPF-originated or redistributed into OSPF
                            if (r.protocol === 'ospf') shouldLearn = true;

                            // Check neighbor redistribution setting
                            if (neighbor.ospfConfig.redistribute) {
                                if (neighbor.ospfConfig.redistribute.some(red => red.protocol === r.protocol)) {
                                    shouldLearn = true;
                                }
                            }

                            // Check neighbor network command (Connected routes that are OSPF enabled)
                            if (r.protocol === 'connected') {
                                // Is this connected route part of OSPF?
                                // Check neighbor's OSPF config matches this route
                                const isOspfEnabled = neighbor.ospfConfig.networks.some(net =>
                                    r.network === net.network // Simplified: Check Network Address Match
                                    // Or simulation: isIpInNetwork logic
                                );
                                if (isOspfEnabled) shouldLearn = true;
                            }

                            if (shouldLearn) {
                                newRoutes.push({
                                    network: r.network,
                                    mask: r.mask,
                                    nextHop: neighbor.ports.find(p => p.id === (conn.sourceDeviceId === neighbor.id ? conn.sourcePortId : conn.targetPortId))?.ipAddress || 'unknown',
                                    interface: myPort.name,
                                    metric: r.metric + 1, // Simple metric increment
                                    protocol: 'ospf'
                                });
                                changed = true;
                            }
                        }
                    }
                }
            }

            // --- BGP Logic ---
            if (dev.bgpConfig) {
                // Find Configured Neighbors
                for (const neighborConfig of dev.bgpConfig.neighbors) {
                    // Start simple: Assume neighbor is directly connected or reachable via existing routes
                    // Find device with this IP
                    // Optimization: We need to find "which device has this IP"
                    // Hack: Scan all L3 devices
                    const neighborDev = l3Devices.find(d => d.ports.some(p => p.ipAddress === neighborConfig.ip));

                    if (neighborDev && neighborDev.bgpConfig) {
                        const neighborRoutes = updatedRoutes.get(neighborDev.id)!;

                        for (const r of neighborRoutes) {
                            if (currentRoutes.some(cr => cr.network === r.network && cr.mask === r.mask)) continue;

                            let shouldLearn = false;

                            // 1. BGP Routes
                            if (r.protocol === 'bgp') {
                                // iBGP/eBGP checks?
                                // eBGP loop prevention: AS Path (omitted for sim complexity)
                                shouldLearn = true;
                            }

                            // 2. Network Command (Local injection)
                            // Neighbor injected connected/static into BGP via network command
                            if (neighborDev.bgpConfig.networks.some(n => n.network === r.network && n.mask === r.mask)) {
                                shouldLearn = true;
                            }

                            // 3. Redistribution
                            if (neighborDev.bgpConfig.redistribute?.some(red => red.protocol === r.protocol)) {
                                shouldLearn = true;
                            }

                            if (shouldLearn) {
                                // Find outgoing interface to neighbor IP
                                // Use routing table lookup? Or assume directly connected for this lab?
                                // Lab R2-R3 is directly connected.
                                // We need nexthop to be neighborConfig.ip
                                newRoutes.push({
                                    network: r.network,
                                    mask: r.mask,
                                    nextHop: neighborConfig.ip,
                                    interface: 'dynamic', // Or lookup
                                    metric: 0,
                                    protocol: 'bgp' // bgp
                                });
                                changed = true;
                            }
                        }
                    }
                }
            }

            // Merge new routes
            if (newRoutes.length > 0) {
                const merged = [...currentRoutes];
                for (const nr of newRoutes) {
                    // Check existing again (to update metric? or avoid dupe)
                    const exist = merged.find(r => r.network === nr.network && r.mask === nr.mask);
                    if (!exist) {
                        merged.push(nr);
                    } else {
                        // Update if better metric? (Simplified: Ignore)
                    }
                }
                updatedRoutes.set(dev.id, merged);
            }
        }
    }

    return updatedRoutes;
}

// Integration helper to update store
// Since we cannot import store here easily (circular?), we just export the logic.
// user of this function updates the devices.
