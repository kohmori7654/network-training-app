/**
 * Cisco IOS風 CLIパーサー
 * モード遷移、コマンド登録、パイプ処理をサポート
 */

import { Device, L2Switch, L3Switch, CliMode, Port, VlanInfo, Connection, EtherChannel, AccessList, AccessListEntry, AccessListType } from '@/stores/types';
import { checkConnectivity } from './connectivityEngine';

// コマンドコンテキスト
export interface CommandContext {
    device: Device;
    mode: CliMode;
    currentInterface?: string;
    selectedPortIds?: string[]; // For interface range
    currentVlan?: number;
    updateDevice: (deviceId: string, updates: Partial<Device>) => void;
    // 接続性チェック用
    allDevices: Device[];
    allConnections: Connection[];
}

// コマンド結果
export interface CommandResult {
    output: string[];
    newMode?: CliMode;
    newInterface?: string;
    newVlan?: number;
    updateConfig?: Partial<Device>;
    selectedPortIds?: string[]; // Added
}

// コマンドハンドラー型
type CommandHandler = (args: string[], context: CommandContext) => CommandResult;

// コマンド定義
interface CommandDefinition {
    pattern: RegExp;
    handler: CommandHandler;
    modes: CliMode[];
    help: string;
}

// パイプ処理
function applyPipe(output: string[], pipeCommand: string): string[] {
    const parts = pipeCommand.trim().split(/\s+/);
    const pipeType = parts[0]?.toLowerCase();
    const pattern = parts.slice(1).join(' ').toLowerCase();

    if (!pattern) return output;

    switch (pipeType) {
        case 'include':
        case 'i':
            return output.filter(line => line.toLowerCase().includes(pattern));
        case 'exclude':
        case 'e':
            return output.filter(line => !line.toLowerCase().includes(pattern));
        case 'begin':
        case 'b':
            const startIndex = output.findIndex(line => line.toLowerCase().includes(pattern));
            return startIndex >= 0 ? output.slice(startIndex) : [];
        case 'section':
        case 's':
            // セクション抽出（簡易実装）
            const results: string[] = [];
            let inSection = false;
            for (const line of output) {
                if (line.toLowerCase().includes(pattern)) {
                    inSection = true;
                } else if (inSection && line.match(/^[^\s]/)) {
                    inSection = false;
                }
                if (inSection) {
                    results.push(line);
                }
            }
            return results;
        default:
            return output;
    }
}

// ========== ヘルパー関数 ==========

function getSwitch(device: Device): L2Switch | L3Switch | null {
    if (device.type === 'l2-switch' || device.type === 'l3-switch') {
        return device as L2Switch | L3Switch;
    }
    return null;
}

function findPort(device: Device, portName: string): Port | undefined {
    const lowerInput = portName.toLowerCase();

    // Cisco abbreviations expansion
    const expanded = lowerInput
        .replace(/^gi(?!gabit)/, 'gigabitethernet')
        .replace(/^fa(?!st)/, 'fastethernet')
        .replace(/^te(?!n)/, 'tengigabitethernet')
        .replace(/^eth(?!hernet)/, 'ethernet')
        .replace(/^po(?!rt-channel)/, 'port-channel');

    const normalizedName = expanded
        .replace(/^gigabitethernet/, 'GigabitEthernet')
        .replace(/^fastethernet/, 'FastEthernet')
        .replace(/^tengigabitethernet/, 'TenGigabitEthernet')
        .replace(/^ethernet/, 'Ethernet')
        .replace(/^port-channel/, 'Port-channel');

    // 1. Exact match (case insensitive)
    // 2. Normalized match (expansion of abbreviations)
    // 3. Prefix match (if unique - optional but good)
    return device.ports.find(p => {
        const pLower = p.name.toLowerCase();
        return pLower === lowerInput ||
            pLower === expanded ||
            pLower === normalizedName.toLowerCase() ||
            // Handle the case where the port name in DB is already short (e.g., Gi1/0/1)
            // but the user typed full GigabitEthernet1/0/1
            (pLower.startsWith('gi') && lowerInput.startsWith('gigabitethernet') && pLower.slice(2) === lowerInput.slice(15));
    });
}

function parseInterfaceRange(device: Device, rangeStr: string): Port[] {
    const ports: Port[] = [];
    const parts = rangeStr.split(/,/);

    for (const part of parts) {
        // Gi1/0/1-4 のような形式を解析
        // 簡易実装: <Prefix><Start>-<End> または <BasePort>-<End>
        // 例: Gi1/0/1-4 -> Gi1/0/1, Gi1/0/2, Gi1/0/3, Gi1/0/4
        // Ciscoでは "interface range Gi1/0/1 - 4" のようにスペースが入ることもあるため、
        // ハイフン前後のスペースを削除して正規化する
        const trimmed = part.trim().replace(/\s*-\s*/g, '-');

        // ハイフンがある場合
        if (trimmed.includes('-')) {
            const [startStr, endStr] = trimmed.split('-');

            // startStr = "Gi1/0/1"
            // endStr = "4" (通常は最後の数字のみ) または "Gi1/0/4"

            // ポート名からプレフィックスと番号を分離する正規表現
            // 例: (Gi1/0/)(1)
            const match = startStr.match(/^(.+?)([0-9]+)$/);
            if (match) {
                const prefix = match[1]; // "Gi1/0/"
                const startNum = parseInt(match[2]);
                let endNum = parseInt(endStr);

                // endStrが完全なポート名の場合 ("Gi1/0/4") の対応は省略し、数字のみと仮定するか
                // あるいは数字のみでなければパースできないとする

                if (isNaN(endNum)) {
                    // ハイフンの後ろが数字でない場合、単純なポート名指定のリストとみなすことも考えられるが
                    // Ciscoでは "interface range Gi1/0/1 - 4" のようにスペースが入ることもある
                    // ここでは "Gi1/0/1-4" 形式のみサポート
                    continue;
                }

                for (let i = startNum; i <= endNum; i++) {
                    const pName = `${prefix}${i}`;
                    const p = findPort(device, pName);
                    if (p) ports.push(p);
                }
            }
        } else {
            // 単一ポート
            const p = findPort(device, trimmed);
            if (p) ports.push(p);
        }
    }
    return ports;
}

function formatVlanTable(vlans: VlanInfo[]): string[] {
    const output = [
        '',
        'VLAN Name                             Status    Ports',
        '---- -------------------------------- --------- -------------------------------',
    ];

    for (const vlan of vlans) {
        const name = vlan.name.padEnd(32);
        const status = vlan.status === 'active' ? 'active   ' : 'suspended';
        output.push(`${String(vlan.id).padStart(4)} ${name} ${status}`);
    }

    return output;
}

function formatInterfaceBrief(device: Device): string[] {
    const output = [
        '',
        'Interface              IP-Address      OK? Method Status                Protocol',
    ];

    for (const port of device.ports.slice(0, 24)) {
        const name = port.name.padEnd(22);
        const ip = 'unassigned'.padEnd(15);
        const ok = 'YES';
        const method = 'unset '.padEnd(6);
        const status = port.status === 'up' ? 'up                   ' : 'administratively down';
        const protocol = port.status === 'up' ? 'up' : 'down';
        output.push(`${name} ${ip} ${ok} ${method} ${status} ${protocol}`);
    }

    return output;
}

function formatInterfaceDescription(device: Device): string[] {
    const output = [
        '',
        'Interface                      Status         Protocol Description',
    ];

    for (const port of device.ports) {
        const name = port.name.padEnd(31);
        const status = (port.status === 'up' ? 'up' : port.status === 'admin-down' ? 'admin down' : 'down').padEnd(15);
        const protocol = (port.status === 'up' ? 'up' : 'down').padEnd(9);
        const description = port.description || '';
        output.push(`${name}${status}${protocol}${description}`);
    }

    return output;
}

function formatMacAddressTable(device: L2Switch | L3Switch): string[] {
    const output = [
        '',
        '          Mac Address Table',
        '-------------------------------------------',
        '',
        'Vlan    Mac Address       Type        Ports',
        '----    -----------       --------    -----',
    ];

    if (device.macAddressTable.length === 0) {
        output.push('Total Mac Addresses for this criterion: 0');
    } else {
        for (const entry of device.macAddressTable) {
            output.push(`${String(entry.vlan).padStart(4)}    ${entry.macAddress}    ${entry.type.padEnd(8)}    ${entry.port}`);
        }
        output.push(`Total Mac Addresses for this criterion: ${device.macAddressTable.length}`);
    }

    return output;
}

function formatArpTable(device: L3Switch): string[] {
    const output = [
        '',
        'Protocol  Address          Age (min)  Hardware Addr   Type   Interface',
    ];

    if (device.arpTable.length === 0) {
        output.push('No ARP entries found.');
    } else {
        for (const entry of device.arpTable) {
            output.push(`Internet  ${entry.ipAddress.padEnd(16)} ${String(entry.age).padStart(9)}  ${entry.macAddress}  ARPA   ${entry.interface}`);
        }
    }

    return output;
}

function isValidIp(ip: string): boolean {
    const parts = ip.split('.');
    if (parts.length !== 4) return false;
    return parts.every(p => {
        const n = parseInt(p);
        return !isNaN(n) && n >= 0 && n <= 255;
    });
}

function parseWildcard(str: string): string | null {
    if (!str) return '0.0.0.0';
    const parts = str.split('.');
    if (parts.length !== 4) return null;
    if (parts.some(p => isNaN(parseInt(p)) || parseInt(p) < 0 || parseInt(p) > 255)) return null;
    return str;
}

function cidrFromMask(mask: string): number {
    return mask.split('.').reduce((acc, part) => {
        const bin = parseInt(part).toString(2);
        return acc + (bin.match(/1/g) || []).length;
    }, 0);
}

function getAdmDistance(protocol: string): number {
    switch (protocol) {
        case 'connected': return 0;
        case 'static': return 1;
        case 'bgp': return 20;
        case 'ospf': return 110;
        default: return 255;
    }
}

function formatSpanningTree(device: L2Switch | L3Switch): string[] {
    const output: string[] = [];
    const stp = device.stpState;

    // VLANごとのSTP情報を表示（PVST+シミュレーション）
    // vlanDbに含まれるactiveなVLANについて表示
    const activeVlans = device.vlanDb
        .filter(v => v.status === 'active')
        .sort((a, b) => a.id - b.id);

    if (activeVlans.length === 0) {
        return ['No Spanning Tree instance found.'];
    }

    // 標準的な値（シミュレーション用）
    const helloTime = 2;
    const maxAge = 20;
    const fwdDelay = 15;
    const agingTime = 300;

    for (const vlan of activeVlans) {
        const vlanIdStr = `VLAN${String(vlan.id).padStart(4, '0')}`;

        // Root ID Logic
        // device.stpState.vlanConfig[vlan.id].rootType === 'primary' なら priority は下がるが、
        // ここでは簡易的に stpState.priority またはデフォルトを使用
        // Root Bridge IDの決定は本来ネットワーク全体の最小BridgeIDだが、
        // シミュレーションでは stpState.rootBridgeId が "そのVLANのルート" を指していると仮定する。
        // 未設定なら自分をルートとみなすか、適当なIDを表示
        const rootId = stp.rootBridgeId || device.macAddress; // fallback to self
        const isRoot = rootId === device.macAddress;

        // Root Priority: 32768 + VLAN ID (default)
        // もし自分がルートでpriority設定があるならそれを使う
        let rootPriority = 32768 + vlan.id;
        if (isRoot && stp.vlanConfig && stp.vlanConfig[vlan.id]) {
            rootPriority = stp.vlanConfig[vlan.id].priority;
        }
        // 相手がルートの場合、相手のPriorityを知る術が stpState にないため、
        // 一般的なデフォルト 32769 (32768+1) や、rootBridgeIdから推測はできない。
        // ここでは見栄えのため 32769 (default priority + sys-id-ext 1? no, vlan id)
        // Cisco default: 32768 + VlanID. So Vlan1 -> 32769.
        if (!isRoot) {
            // 他人がルートの場合のPriorityは不明だが、32769としておく
            rootPriority = 32768 + vlan.id;
        }


        // Bridge ID (My ID) Logic
        let myPriority = 32768 + vlan.id;
        if (stp.vlanConfig && stp.vlanConfig[vlan.id]) {
            myPriority = stp.vlanConfig[vlan.id].priority;
        }

        output.push(vlanIdStr);
        output.push(`  Spanning tree enabled protocol ieee`);
        output.push(`  Root ID    Priority    ${rootPriority}`);
        output.push(`             Address     ${rootId}`);
        if (isRoot) {
            output.push(`             This bridge is the root`);
        }
        output.push(`             Hello Time   ${helloTime} sec  Max Age ${maxAge} sec  Forward Delay ${fwdDelay} sec`);
        output.push('');
        output.push(`  Bridge ID  Priority    ${myPriority}  (priority ${myPriority - vlan.id} sys-id-ext ${vlan.id})`);
        output.push(`             Address     ${device.macAddress}`);
        output.push(`             Hello Time   ${helloTime} sec  Max Age ${maxAge} sec  Forward Delay ${fwdDelay} sec`);
        output.push(`             Aging Time  ${agingTime} sec`);
        output.push('');
        output.push(`    Interface        Role Sts Cost      Prio.Nbr Type`);
        output.push(`    ---------------- ---- --- --------- -------- --------------------------------`);

        // Interfaces for this VLAN
        // Access ports in this VLAN + Trunk ports (allowing this VLAN)
        const vlanPorts = device.ports.filter(p => {
            if (p.status !== 'up') return false;
            if (p.mode === 'access' && p.vlan === vlan.id) return true;
            if (p.mode === 'trunk') {
                // Check allowed vlans
                if (!p.trunkAllowedVlans) return true; // all allowed
                return p.trunkAllowedVlans.includes(vlan.id);
            }
            return false;
        });

        // ソート: Gi0/1, Gi0/2...
        vlanPorts.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

        for (const port of vlanPorts) {
            const name = port.name.padEnd(16);

            // Port State from stpState
            // stpState.portStates key is portId
            const stpPortState = stp.portStates[port.id] || 'forwarding'; // Default FWD

            let role = 'Desg';
            let status = 'FWD';

            if (stpPortState === 'blocking') {
                role = 'Altn';
                status = 'BLK';
            } else if (stpPortState === 'learning') {
                role = 'Desg'; // or ???
                status = 'LRN';
            } else if (stpPortState === 'listening') {
                role = 'Desg';
                status = 'LIS'; // Cisco uses LIS? Usually LRN/BLK/FWD seen mostly. 
            } else if (stpPortState === 'disabled') {
                // usually not shown if link down, but if up and stp disabled?
                role = 'Dsbl';
                status = 'FWD';
            }

            // Root Port Logic:
            // 簡易判定: 自分がルートでなければ、ルートへのパスを持つポートがRoot Port
            // シミュレーションデータに "rootPortId" がないため、推測する。
            // Blockでないポートのうち、uplinkっぽいものをRootにする... は難しい。
            // ここでは "Root Bridge ID" と繋がっているポート、あるいは適当なルールが必要。
            // もし stpState に rootPort の情報があればベストだが、ない。
            // 暫定: forwardingのポートのうち、最初の1つをRoot Portと表示する（自分がルートでない場合）
            // *修正*: stpStateの定義を拡張できないので、Altn(Blocking)以外で、かつ非ルートブリッジなら
            // 1つはRoot Portがあるはず。
            // 完全に正しく表示するにはバックエンドのSTP計算ロジックからの情報が必要。
            // 今回は表示の実装なので、役割はモック化せざるを得ない場合がある。

            // 簡易ロジック:
            // 自分がルート -> 全て Desg
            if (isRoot) {
                role = 'Desg';
            } else {
                // ルートでない
                if (status === 'BLK') {
                    role = 'Altn';
                } else {
                    // FWDのポート。
                    // ここでどれがRootでどれがDesgか判別不能。
                    // とりあえず "Desg" にしておく。(Root Port判定は複雑なため)
                    // もし connectedTo の先が Root Bridge ID と一致すれば Root Port の可能性大だが...
                }
            }

            // Cost
            // 10Mbps=100, 100Mbps=19, 1Gbps=4, 10Gbps=2
            let cost = 4; // Default 1G
            if (port.speed === '100Mbps') cost = 19;
            if (port.speed === '10Mbps') cost = 100;
            if (port.speed === '10Gbps') cost = 2;
            const costStr = String(cost).padEnd(9);

            // Prio.Nbr
            // Cisco: 128.PortNumber
            // Port IDから番号を抽出してみる "Gi0/1" -> 1
            const match = port.name.match(/(\d+)$/);
            const portNum = match ? parseInt(match[1]) : 0;
            const prioNbr = `128.${portNum}`.padEnd(8);

            const type = 'P2p'; // Shared or P2p. Link is full duplex -> P2p.

            output.push(`    ${name} ${role} ${status} ${costStr} ${prioNbr} ${type}`);
        }
        output.push('');
    }

    return output;
}

// ========== コマンドハンドラー ==========

const commands: CommandDefinition[] = [
    // ===== モード遷移 =====
    {
        pattern: /^show\s+spanning-tree$/i,
        modes: ['user', 'privileged', 'global-config'], // 通常showはどこでも打てる(do show...)、ここでは主要モードで許可
        help: 'show spanning-tree - Show spanning tree information',
        handler: (_, context) => {
            const sw = getSwitch(context.device);
            if (!sw) {
                return { output: ['% This command is supported only on switches'] };
            }
            return { output: formatSpanningTree(sw) };
        }
    },
    {
        pattern: /^enable$/i,
        modes: ['user'],
        help: 'enable - Enter privileged EXEC mode',
        handler: () => ({ output: [], newMode: 'privileged' }),
    },
    {
        pattern: /^en$/i,
        modes: ['user'],
        help: '',
        handler: () => ({ output: [], newMode: 'privileged' }),
    },
    {
        pattern: /^wr(?:ite)?(?:\s+mem(?:ory)?)?$/i,
        modes: ['privileged'],
        help: 'write memory - Save configuration',
        handler: (_, context) => {
            const dev = context.device as L2Switch | L3Switch; // PCにはない想定
            if (!dev.runningConfig) return { output: ['% Not supported'] };

            return {
                output: ['Building configuration...', '[OK]'],
                updateConfig: { startupConfig: [...dev.runningConfig] } as any
            };
        },
    },
    {
        pattern: /^copy\s+run(?:ning-config)?\s+start(?:up-config)?$/i,
        modes: ['privileged'],
        help: 'copy running-config startup-config - Save configuration',
        handler: (_, context) => {
            const dev = context.device as L2Switch | L3Switch;
            if (!dev.runningConfig) return { output: ['% Not supported'] };

            return {
                output: ['Destination filename [startup-config]? ', 'Building configuration...', '[OK]'],
                updateConfig: { startupConfig: [...dev.runningConfig] } as any
            };
        },
    },
    {
        pattern: /^reload$/i,
        modes: ['privileged'],
        help: 'reload - Halt and perform a cold restart',
        handler: (_, context) => {
            const dev = context.device as L2Switch | L3Switch;
            // 簡易Reload: runningConfig を startupConfig で上書き
            // 本当はインターフェース状態などもリセットすべきだが、Configに基づくものはConfig反映で直るはず
            // ただし、ポートの物理接続状態(connectedTo / status)は維持すべきか？
            // 本当はインターフェース状態などもリセットすべきだが、シミュレータでは接続は維持、プロトコル状態初期化
            // ここでは「Configの復元」のみ行う

            if (!dev.startupConfig) return { output: ['% Not supported'] };

            return {
                output: ['Proceed with reload? [confirm]', 'Reloading...'],
                updateConfig: {
                    runningConfig: [...dev.startupConfig],
                    // Restore Hostname from startup-config
                    ...(() => {
                        const hostnameLine = dev.startupConfig?.find(l => l.startsWith('hostname '));
                        if (hostnameLine) {
                            const newHostname = hostnameLine.split(' ')[1];
                            return { hostname: newHostname, name: newHostname };
                        }
                        return {};
                    })()
                } as any
            };
        },
    },
    {
        pattern: /^disable$/i,
        modes: ['privileged', 'global-config', 'interface-config', 'vlan-config'],
        help: 'disable - Exit privileged mode',
        handler: () => ({ output: [], newMode: 'user' }),
    },
    {
        pattern: /^conf(?:igure)?\s*t(?:erminal)?$/i,
        modes: ['privileged'],
        help: 'configure terminal - Enter configuration mode',
        handler: () => ({
            output: ['Enter configuration commands, one per line. End with CNTL/Z.'],
            newMode: 'global-config',
        }),
    },
    {
        pattern: /^end$/i,
        modes: ['global-config', 'interface-config', 'vlan-config'],
        help: 'end - Exit to privileged EXEC mode',
        handler: () => ({ output: [], newMode: 'privileged' }),
    },
    {
        pattern: /^exit$/i,
        modes: ['user', 'privileged', 'global-config', 'interface-config', 'vlan-config'],
        help: 'exit - Exit current mode',
        handler: (_, context) => {
            const modeTransitions: Record<CliMode, CliMode> = {
                'user': 'user',
                'privileged': 'user',
                'global-config': 'privileged',
                'interface-config': 'global-config',
                'vlan-config': 'global-config',
                'router-ospf-config': 'global-config',
                'router-bgp-config': 'global-config',
                'line-config': 'global-config',
            };
            return { output: [], newMode: modeTransitions[context.mode] };
        },
    },

    // ===== インターフェース設定 =====
    {
        pattern: /^int(?:erface)?\s+range\s+(.+)$/i,
        modes: ['global-config'],
        help: 'interface range <list> - Select a range of interfaces',
        handler: (args, context) => {
            const rangeStr = args[0];
            const ports = parseInterfaceRange(context.device, rangeStr);

            if (ports.length === 0) {
                return { output: ['% No valid interfaces found in range'] };
            }

            // selectedPortIdsに格納 (contextの型拡張が必要)
            // context.selectedPortIds = ports.map(p => p.id); 
            // processCliCommand側でstateを更新する必要があるが、CommandResultで返す

            // 簡易的に newInterface には最初のポート名を入れるが、裏で selectedPortIds を更新する仕組みが必要
            // ここでは CommandResult に customStateUpdate のようなものを追加するか、
            // currentInterface を "range" とし、内部状態を持つ

            // 互換性のため currentInterface もセットするが、実際の処理は context.selectedPortIds を参照させる
            return {
                output: [],
                newMode: 'interface-config',
                newInterface: 'range', // UI表示用
                selectedPortIds: ports.map(p => p.id),
                // 特殊なプロパティで選択ポートを渡す(呼び出し元で処理が必要)
                // 今回は cliParser.ts 内の CommandContext を直接書き換えられないため
                // newModeなどと一緒に返すデータを拡張する
                // => CommandResult型定義の変更はスコープ外のため、
                // CommandContextは参照渡しであることを利用して、呼び出し元のstate更新ロジックに依存せず
                // ここで更新できないか？ -> React stateなので不可。
                // したがって、processCliCommandの戻り値を受け取る側(TerminalPanel)で context 更新が必要。
                // *しかし* processCliCommandは純粋関数的に振る舞う設計。
                // *CommandResult* に selectedPortIds を追加するのが正しい。
                // 型定義を修正する余裕がない場合、内部的に処理する。
                // 今回は types.ts を修正したので CommandContext に selectedPortIds があるはずだが
                // updateDevice のように updateContext があるわけではない。

                // 解決策: CommandResult に汎用的な state 更新を含めることができないため
                // newInterface にカンマ区切りでIDを入れる等のハックよりは
                // 既存の CommandResult を拡張すべきだが、ここでは簡易的に
                // updateConfig でデバイスのプロパティとして一時的に持たせる等は副作用が大きい。

                // => context.selectedPortIds は呼び出し元から未定義で来る。
                // 次のコマンド実行時に渡される必要がある。
                // TerminalState に selectedPortIds を追加した (types.ts)。
                // よって、この関数の戻り値でそれを更新するように指示する必要がある。

                // 既存の CommandResult には 'updateTerminalState' がない。
                // 'newInterface' を string[] にするのは型変更が大きい。
                // *妥協策*: processCliCommandの呼び出し元(useNetworkStore.ts等)で、
                // interface-configモード遷移時にコマンドが "interface range" だった場合、
                // selectedPortIdsを計算してTerminalStateにセットするロジックを追加する？
                // いや、cliParser内で完結させたい。

                // ここでは cliParser.ts の先頭で CommandResult を修正していないため、
                // handle中で無理やり通すか、cliParser.tsのCommandResult型を修正するか。
                // -> CommandResultインターフェースは cliParser.ts 内にあるので修正可能。
            };
        },
    },
    {
        pattern: /^int(?:erfaces?)?\s+(.+)$/i,
        modes: ['global-config'],
        help: 'interface <name> - Enter interface configuration mode',
        handler: (args, context) => {
            const ifName = args[0];

            // rangeコマンドは別ハンドラで処理されるはずだが、正規表現が重なる可能性
            if (ifName.toLowerCase().startsWith('range ')) {
                // regexの順序あるいは正規表現の見直しが必要だが、配列順で range が先にあればOK
                // ここではフォールバック
                return { output: [] }; // re-process? No.
            }

            let port = findPort(context.device, ifName);

            // SVI (Vlan Interface) Handling
            if (!port && ifName.toLowerCase().startsWith('vlan')) {
                const match = ifName.match(/(\d+)/);
                if (match) {
                    const vlanId = parseInt(match[1]);
                    const sw = getSwitch(context.device);

                    // Allow SVI on L2 and L3 switches
                    if (sw) {
                        // Check if VLAN exists in DB? Usually Cisco creates it or warns.
                        // For simplicity, we create the interface.
                        const sviName = `Vlan${vlanId}`;

                        // Check if SVI port already exists
                        const existingSvi = sw.ports.find(p => p.name === sviName);
                        if (existingSvi) {
                            return {
                                output: [],
                                newMode: 'interface-config',
                                newInterface: sviName,
                            };
                        }

                        // Create new SVI Port
                        const newSvi: Port = {
                            id: `vlan-${vlanId}-${context.device.id}`,
                            name: sviName,
                            connectedTo: null,
                            status: 'up', // Default up
                            vlan: vlanId,
                            mode: 'routed', // Treat as routed logic (L3 endpoint)
                            trunkAllowedVlans: undefined,
                        };

                        return {
                            output: [], // Cisco: "Interface VlanX, changed state to up"
                            newMode: 'interface-config',
                            newInterface: sviName,
                            updateConfig: {
                                ports: [...sw.ports, newSvi]
                            }
                        };
                    }
                }
            }

            // Port-channelの場合、存在しなければ作成
            if (!port && ifName.toLowerCase().startsWith('po')) {
                const match = ifName.match(/(\d+)/);
                if (match) {
                    const chId = parseInt(match[1]);
                    const sw = getSwitch(context.device);
                    if (sw) {
                        const newPortName = `Po${chId}`;
                        const newPort: Port = {
                            id: `po-${chId}-${context.device.id}`,
                            name: newPortName,
                            connectedTo: null,
                            status: 'down',
                            vlan: 1,
                            mode: 'access',
                            trunkAllowedVlans: undefined,
                            channelGroup: chId,
                        };
                        const newChannel: EtherChannel = { id: chId, protocol: 'on', status: 'down' };

                        return {
                            output: [`Creating a port-channel interface Port-channel ${chId}`],
                            newMode: 'interface-config',
                            newInterface: newPortName,
                            updateConfig: {
                                ports: [...sw.ports, newPort],
                                etherChannels: [...(sw.etherChannels || []), newChannel]
                            }
                        };
                    }
                }
            }

            if (!port) {
                return { output: [`% Invalid interface: ${ifName}`] };
            }

            return {
                output: [],
                newMode: 'interface-config',
                newInterface: port.name,
            };
        },
    },
    {
        pattern: /^channel-group\s+(\d+)\s+mode\s+(on|active|passive|desirable|auto)$/i,
        modes: ['interface-config'],
        help: 'channel-group <id> mode <mode> - Assign interface to EtherChannel',
        handler: (args, context) => {
            const chId = parseInt(args[0]);
            const modeName = args[1].toLowerCase();

            // 対象ポートの決定 (単一 or 複数)
            const targetPortIds = context.selectedPortIds || (context.currentInterface ? [findPort(context.device, context.currentInterface)?.id].filter(id => id) as string[] : []);

            if (targetPortIds.length === 0) return { output: ['% No interface selected'] };

            const sw = getSwitch(context.device);
            if (!sw) return { output: ['% Invalid device'] };

            let updatedPorts = [...sw.ports];
            let updatedChannels = [...(sw.etherChannels || [])];

            // EtherChannelが存在しない場合は作成
            if (!updatedChannels.some(ch => ch.id === chId)) {
                updatedChannels.push({
                    id: chId,
                    protocol: modeName === 'on' ? 'on' : 'lacp',
                    status: 'up',
                });
                const poName = `Po${chId}`;
                if (!updatedPorts.find(p => p.name === poName)) {
                    updatedPorts.push({
                        id: `po-${chId}-${context.device.id}`,
                        name: poName,
                        connectedTo: null,
                        status: 'up',
                        vlan: 1,
                        mode: 'access',
                    });
                }
            }

            // 選択された全ポートを更新
            for (const pid of targetPortIds) {
                updatedPorts = updatedPorts.map(p =>
                    p.id === pid ? { ...p, channelGroup: chId } : p
                );
            }

            return {
                output: [`Creating a port-channel interface Port-channel ${chId}`],
                updateConfig: {
                    ports: updatedPorts,
                    etherChannels: updatedChannels,
                }
            };
        }
    },
    {
        pattern: /^no\s+channel-group$/i,
        modes: ['interface-config'],
        help: 'no channel-group - Remove interface from EtherChannel',
        handler: (_, context) => {
            const targetPortIds = context.selectedPortIds || (context.currentInterface ? [findPort(context.device, context.currentInterface)?.id].filter(id => id) as string[] : []);
            if (targetPortIds.length === 0) return { output: ['% No interface selected'] };

            const sw = getSwitch(context.device);
            if (!sw) return { output: ['% Invalid device'] };

            const updatedPorts = sw.ports.map(p => {
                if (targetPortIds.includes(p.id)) {
                    // eslint-disable-next-line @typescript-eslint/no-unused-vars
                    const { channelGroup, ...rest } = p;
                    return rest;
                }
                return p;
            });

            return { output: [], updateConfig: { ports: updatedPorts } };
        },
    },
    {
        pattern: /^shutdown$/i,
        modes: ['interface-config'],
        help: 'shutdown - Disable interface',
        handler: (_, context) => {
            const targetPortIds = context.selectedPortIds || (context.currentInterface ? [findPort(context.device, context.currentInterface)?.id].filter(id => id) as string[] : []);
            if (targetPortIds.length === 0) return { output: ['% No interface selected'] };

            const sw = getSwitch(context.device);
            if (!sw) return { output: ['% Invalid device'] };

            const updatedPorts = sw.ports.map(p =>
                targetPortIds.includes(p.id) ? { ...p, status: 'admin-down' as const } : p
            );

            return { output: [], updateConfig: { ports: updatedPorts } };
        },
    },
    {
        pattern: /^no\s+shutdown$/i,
        modes: ['interface-config'],
        help: 'no shutdown - Enable interface',
        handler: (_, context) => {
            const targetPortIds = context.selectedPortIds || (context.currentInterface ? [findPort(context.device, context.currentInterface)?.id].filter(id => id) as string[] : []);
            if (targetPortIds.length === 0) return { output: ['% No interface selected'] };

            const sw = getSwitch(context.device);
            if (!sw) return { output: ['% Invalid device'] };

            const updatedPorts = sw.ports.map(p => {
                if (targetPortIds.includes(p.id)) {
                    // connectedTo (物理接続) があれば up、なければ down (admin-down解除という意味で)
                    // シミュレータの型としては 'up' | 'down' | 'admin-down' なので、
                    // 未接続時の no shutdown は 'down' が適切。
                    const newStatus = p.connectedTo ? 'up' : 'down';
                    return { ...p, status: newStatus as 'up' | 'down' };
                }
                return p;
            });

            return { output: [], updateConfig: { ports: updatedPorts } };
        },
    },
    {
        pattern: /^switchport\s+mode\s+(access|trunk|dynamic\s+auto|dynamic\s+desirable)$/i,
        modes: ['interface-config'],
        help: 'switchport mode <access|trunk|dynamic> - Set interface mode',
        handler: (args, context) => {
            const arg = args[0].toLowerCase(); // "access", "trunk", "dynamic auto", "dynamic desirable"
            const targetPortIds = context.selectedPortIds || (context.currentInterface ? [findPort(context.device, context.currentInterface)?.id].filter(id => id) as string[] : []);
            if (targetPortIds.length === 0) return { output: ['% No interface selected'] };

            const sw = getSwitch(context.device);
            if (!sw) return { output: ['% Invalid device'] };

            let mode: 'access' | 'trunk' | 'dynamic' | 'routed'; // 'routed' is handled by no switchport
            let dtpMode: 'dynamic-auto' | 'dynamic-desirable' | 'none';

            if (arg === 'access') {
                mode = 'access';
                dtpMode = 'none';
            } else if (arg === 'trunk') {
                mode = 'trunk';
                dtpMode = 'none';
            } else if (arg.includes('auto')) {
                mode = 'dynamic';
                dtpMode = 'dynamic-auto';
            } else {
                mode = 'dynamic';
                dtpMode = 'dynamic-desirable';
            }

            const updatedPorts = sw.ports.map(p =>
                targetPortIds.includes(p.id) ? { ...p, mode, dtpMode } : p
            );

            return { output: [], updateConfig: { ports: updatedPorts } };
        },
    },
    {
        pattern: /^no\s+switchport$/i,
        modes: ['interface-config'],
        help: 'no switchport - Convert to routed port (L3)',
        handler: (_, context) => {
            const targetPortIds = context.selectedPortIds || (context.currentInterface ? [findPort(context.device, context.currentInterface)?.id].filter(id => id) as string[] : []);
            if (targetPortIds.length === 0) return { output: ['% No interface selected'] };

            if (context.device.type !== 'l3-switch') {
                return { output: ['% Command rejected: "no switchport" not supported on L2 device'] };
            }

            const sw = context.device as L3Switch;
            const updatedPorts = sw.ports.map(p =>
                targetPortIds.includes(p.id) ? { ...p, mode: 'routed' as const } : p
            );

            return { output: [], updateConfig: { ports: updatedPorts } };
        },
    },
    {
        pattern: /^switchport$/i,
        modes: ['interface-config'],
        help: 'switchport - Convert to switchport (L2)',
        handler: (_, context) => {
            const targetPortIds = context.selectedPortIds || (context.currentInterface ? [findPort(context.device, context.currentInterface)?.id].filter(id => id) as string[] : []);
            if (targetPortIds.length === 0) return { output: ['% No interface selected'] };

            const sw = getSwitch(context.device);
            if (!sw) return { output: ['% Invalid device'] };

            const updatedPorts = sw.ports.map(p =>
                targetPortIds.includes(p.id) ? { ...p, mode: 'access' as const, ipAddress: undefined, subnetMask: undefined } : p
            );

            return { output: [], updateConfig: { ports: updatedPorts } };
        },
    },
    {
        pattern: /^description\s+(.+)$/i,
        modes: ['interface-config'],
        help: 'description <text> - Set interface description',
        handler: (args, context) => {
            const description = args[0];
            const targetPortIds = context.selectedPortIds || (context.currentInterface ? [findPort(context.device, context.currentInterface)?.id].filter(id => id) as string[] : []);
            if (targetPortIds.length === 0) return { output: ['% No interface selected'] };

            const sw = context.device;
            const updatedPorts = sw.ports.map(p =>
                targetPortIds.includes(p.id) ? { ...p, description } : p
            );

            return { output: [], updateConfig: { ports: updatedPorts } };
        },
    },
    {
        pattern: /^no\s+description$/i,
        modes: ['interface-config'],
        help: 'no description - Remove interface description',
        handler: (_, context) => {
            const targetPortIds = context.selectedPortIds || (context.currentInterface ? [findPort(context.device, context.currentInterface)?.id].filter(id => id) as string[] : []);
            if (targetPortIds.length === 0) return { output: ['% No interface selected'] };

            const sw = context.device;
            const updatedPorts = sw.ports.map(p => {
                if (targetPortIds.includes(p.id)) {
                    // eslint-disable-next-line @typescript-eslint/no-unused-vars
                    const { description, ...rest } = p;
                    return rest;
                }
                return p;
            });

            return { output: [], updateConfig: { ports: updatedPorts } };
        },
    },
    {
        pattern: /^switchport\s+trunk\s+allowed\s+vlan\s+(.+)$/i,
        modes: ['interface-config'],
        help: 'switchport trunk allowed vlan ...',
        handler: (args, context) => {
            const arg = args[0].toLowerCase();
            const targetPortIds = context.selectedPortIds || (context.currentInterface ? [findPort(context.device, context.currentInterface)?.id].filter(id => id) as string[] : []);
            if (targetPortIds.length === 0) return { output: ['% No interface selected'] };

            const sw = getSwitch(context.device);
            if (!sw) return { output: ['% Invalid device'] };

            let newAllowed: number[] = [];
            if (arg === 'all') newAllowed = Array.from({ length: 4094 }, (_, i) => i + 1);
            else if (arg === 'none') newAllowed = [];
            else {
                const vlans = new Set<number>();
                // remove "add", "remove" prefix if present (simple hack)
                const cleanArg = arg.replace(/^(add|remove)\s+/, '');
                // Note: proper add/remove logic is complex, defaulting to replace for now unless "add/remove" support requested specifically

                const parts = cleanArg.split(',');
                for (const part of parts) {
                    if (part.includes('-')) {
                        const [start, end] = part.split('-').map(Number);
                        for (let i = start; i <= end; i++) vlans.add(i);
                    } else {
                        vlans.add(Number(part));
                    }
                }
                newAllowed = Array.from(vlans).sort((a, b) => a - b);
            }

            const updatedPorts = sw.ports.map(p =>
                targetPortIds.includes(p.id) ? { ...p, trunkAllowedVlans: newAllowed } : p
            );

            return { output: [], updateConfig: { ports: updatedPorts } };
        },
    },
    {
        pattern: /^no\s+switchport\s+trunk\s+allowed\s+vlan$/i,
        modes: ['interface-config'],
        help: 'no switchport trunk allowed vlan - Reset allowed VLANs to default (all)',
        handler: (_, context) => {
            const targetPortIds = context.selectedPortIds || (context.currentInterface ? [findPort(context.device, context.currentInterface)?.id].filter(id => id) as string[] : []);
            if (targetPortIds.length === 0) return { output: ['% No interface selected'] };

            const sw = getSwitch(context.device);
            if (!sw) return { output: ['% Invalid device'] };

            const updatedPorts = sw.ports.map(p =>
                targetPortIds.includes(p.id) ? { ...p, trunkAllowedVlans: undefined } : p
            );

            return { output: [], updateConfig: { ports: updatedPorts } };
        },
    },
    {
        pattern: /^switchport\s+access\s+vlan\s+(\d+)$/i,
        modes: ['interface-config'],
        help: 'switchport access vlan <id>',
        handler: (args, context) => {
            const vlanId = parseInt(args[0]);
            const targetPortIds = context.selectedPortIds || (context.currentInterface ? [findPort(context.device, context.currentInterface)?.id].filter(id => id) as string[] : []);
            if (targetPortIds.length === 0) return { output: ['% No interface selected'] };

            const sw = getSwitch(context.device);
            if (!sw) return { output: ['% Invalid device'] };

            const updatedPorts = sw.ports.map(p =>
                targetPortIds.includes(p.id) ? { ...p, vlan: vlanId } : p
            );

            return { output: [], updateConfig: { ports: updatedPorts } };
        },
    },
    {
        pattern: /^spanning-tree\s+portfast$/i,
        modes: ['interface-config'],
        help: 'spanning-tree portfast',
        handler: (_, context) => {
            // Mock: Just accept command
            return { output: [] };
        }
    },
    {
        pattern: /^ip\s+address\s+(\d+\.\d+\.\d+\.\d+)\s+(\d+\.\d+\.\d+\.\d+)$/i,
        modes: ['interface-config'],
        help: 'ip address <ip> <mask>',
        handler: (args, context) => {
            const [ip, mask] = args;
            const targetPortIds = context.selectedPortIds || (context.currentInterface ? [findPort(context.device, context.currentInterface)?.id].filter(id => id) as string[] : []);

            // Handle SVI by currentInterface name
            if (context.currentInterface?.toLowerCase().startsWith('vlan')) {
                const sw = context.device;
                if (getSwitch(sw)) { // Ensure it's a switch
                    const sviPort = sw.ports.find(p => p.name.toLowerCase() === context.currentInterface?.toLowerCase());
                    if (sviPort) {
                        const updatedPorts = sw.ports.map(p =>
                            p.id === sviPort.id ? { ...p, ipAddress: ip, subnetMask: mask } : p
                        );
                        return { output: [], updateConfig: { ports: updatedPorts } };
                    }
                }
            }

            // Case 2: Routed Port
            if (targetPortIds.length > 0) {
                const sw = context.device;
                const ports = sw.ports.filter(p => targetPortIds.includes(p.id));

                // If L3 Switch and port is routed
                if (sw.type === 'l3-switch') {
                    const routedPorts = ports.filter(p => p.mode === 'routed');
                    if (routedPorts.length === ports.length) {
                        // Apply IP
                        const updatedPorts = sw.ports.map(p =>
                            targetPortIds.includes(p.id) ? { ...p, ipAddress: ip, subnetMask: mask } : p
                        );
                        return { output: [], updateConfig: { ports: updatedPorts } };
                    } else if (routedPorts.length > 0) {
                        // Some routed, some not
                        return { output: ['% Some interfaces are not routed ports'] };
                    } else {
                        return { output: ['% IP address only allowed on routed ports (no switchport)'] };
                    }
                }
            }

            return { output: ['% Invalid interface for IP address'] };
        }
    },
    {
        pattern: /^no\s+ip\s+address$/i,
        modes: ['interface-config'],
        help: 'no ip address - Remove IP address',
        handler: (_, context) => {
            const targetPortIds = context.selectedPortIds || (context.currentInterface ? [findPort(context.device, context.currentInterface)?.id].filter(id => id) as string[] : []);

            // Handle SVI
            if (context.currentInterface?.toLowerCase().startsWith('vlan')) {
                const sw = context.device;
                if (getSwitch(sw)) {
                    const sviPort = sw.ports.find(p => p.name.toLowerCase() === context.currentInterface?.toLowerCase());
                    if (sviPort) {
                        const updatedPorts = sw.ports.map(p => {
                            if (p.id === sviPort.id) {
                                // eslint-disable-next-line @typescript-eslint/no-unused-vars
                                const { ipAddress, subnetMask, ...rest } = p;
                                return rest;
                            }
                            return p;
                        });
                        return { output: [], updateConfig: { ports: updatedPorts } };
                    }
                }
            }

            // Routed Port
            if (targetPortIds.length > 0) {
                const sw = context.device;
                const updatedPorts = sw.ports.map(p => {
                    if (targetPortIds.includes(p.id)) {
                        // eslint-disable-next-line @typescript-eslint/no-unused-vars
                        const { ipAddress, subnetMask, ...rest } = p;
                        return rest;
                    }
                    return p;
                });
                return { output: [], updateConfig: { ports: updatedPorts } };
            }

            return { output: ['% Invalid interface'] };
        }
    },

    // ===== HSRP (Standby) Commands =====
    {
        pattern: /^standby\s+(\d+)\s+ip\s+(\d+\.\d+\.\d+\.\d+)$/i,
        modes: ['interface-config'],
        help: 'standby <group> ip <address>',
        handler: (args, context) => {
            if (context.device.type !== 'l3-switch') return { output: ['% command available only on L3 Switch'] };

            // Check if we are in Interface Vlan
            if (!context.currentInterface?.toLowerCase().startsWith('vlan')) {
                return { output: ['% HSRP is only supported on VLAN interfaces (SVI) in this simulator'] };
            }

            const group = parseInt(args[0]);
            const ip = args[1];
            const sw = context.device as L3Switch;
            const groups = [...sw.hsrpGroups];

            const existingIdx = groups.findIndex(g => g.group === group);
            if (existingIdx >= 0) {
                groups[existingIdx] = { ...groups[existingIdx], virtualIp: ip };
            } else {
                groups.push({
                    group,
                    virtualIp: ip,
                    priority: 100, // Def
                    preempt: false,
                    state: 'active', // Simplified: default active for sim reachability
                    helloTimer: 3,
                    holdTimer: 10,
                });
            }

            return { output: [], updateConfig: { hsrpGroups: groups } };
        }
    },
    {
        pattern: /^standby\s+(\d+)\s+priority\s+(\d+)$/i,
        modes: ['interface-config'],
        help: 'standby <group> priority <value>',
        handler: (args, context) => {
            if (context.device.type !== 'l3-switch') return { output: ['% command available only on L3 Switch'] };
            const group = parseInt(args[0]);
            const priority = parseInt(args[1]);
            const sw = context.device as L3Switch;
            const groups = [...sw.hsrpGroups];

            const existingIdx = groups.findIndex(g => g.group === group);
            if (existingIdx >= 0) {
                groups[existingIdx] = { ...groups[existingIdx], priority };
                return { output: [], updateConfig: { hsrpGroups: groups } };
            }
            return { output: ['% HSRP group not found. Set IP first.'] };
        }
    },
    {
        pattern: /^standby\s+(\d+)\s+preempt$/i,
        modes: ['interface-config'],
        help: 'standby <group> preempt',
        handler: (args, context) => {
            if (context.device.type !== 'l3-switch') return { output: ['% command available only on L3 Switch'] };
            const group = parseInt(args[0]);
            const sw = context.device as L3Switch;
            const groups = [...sw.hsrpGroups];

            const existingIdx = groups.findIndex(g => g.group === group);
            if (existingIdx >= 0) {
                groups[existingIdx] = { ...groups[existingIdx], preempt: true };
                return { output: [], updateConfig: { hsrpGroups: groups } };
            }
            return { output: ['% HSRP group not found. Set IP first.'] };
        }
    },

    // Show Standby
    {
        pattern: /^show\s+standby(?:\s+brief)?$/i,
        modes: ['privileged', 'global-config'],
        help: 'show standby - Show HSRP status',
        handler: (_, context) => {
            if (context.device.type !== 'l3-switch') return { output: ['% command available only on L3 Switch'] };
            const sw = context.device as L3Switch;

            if (sw.hsrpGroups.length === 0) return { output: ['No HSRP groups configured'] };

            const output = [
                '                     P indicates configured to preempt.',
                '                     |',
                'Interface   Grp  Pri P State   Active          Standby         Virtual IP',
            ];

            const lines = sw.hsrpGroups.map(g => {
                const ifName = `Vlan${g.group}`.padEnd(11);
                const grp = String(g.group).padEnd(4);
                const pri = String(g.priority).padEnd(3);
                const p = g.preempt ? 'P' : ' ';
                const state = (g.state || 'Active').padEnd(7);
                const active = 'local'.padEnd(15);
                const standby = 'unknown'.padEnd(15);
                const vip = g.virtualIp;
                return `${ifName} ${grp} ${pri} ${p} ${state} ${active} ${standby} ${vip}`;
            });

            return { output: [...output, ...lines] };
        }
    },

    // ===== Global STP & Gateway =====
    {
        pattern: /^spanning-tree\s+vlan\s+(.+)\s+root\s+(primary|secondary)$/i,
        modes: ['global-config'],
        help: 'spanning-tree vlan <list> root ...',
        handler: (args, context) => {
            const vlanStr = args[0];
            const rootType = args[1].toLowerCase(); // primary | secondary
            const priority = rootType === 'primary' ? 24576 : 28672;

            const sw = getSwitch(context.device);
            if (!sw) return { output: ['% Command only valid on switches'] };

            const vlanIds: number[] = [];
            // Simple comma/dash parser
            const parts = vlanStr.split(',');
            for (const part of parts) {
                if (part.includes('-')) {
                    const [s, e] = part.split('-').map(Number);
                    if (!isNaN(s) && !isNaN(e)) {
                        for (let i = s; i <= e; i++) vlanIds.push(i);
                    }
                } else {
                    const v = parseInt(part);
                    if (!isNaN(v)) vlanIds.push(v);
                }
            }

            const newStpState = { ...sw.stpState };
            newStpState.vlanConfig = newStpState.vlanConfig || {};

            for (const vid of vlanIds) {
                newStpState.vlanConfig[vid] = {
                    priority,
                    rootType: rootType as 'primary' | 'secondary'
                };
            }

            return {
                output: [],
                updateConfig: { stpState: newStpState }
            };
        }
    },
    {
        pattern: /^spanning-tree\s+vlan\s+(.+)\s+priority\s+(\d+)$/i,
        modes: ['global-config'],
        help: 'spanning-tree vlan <list> priority <0-61440>',
        handler: (args, context) => {
            const vlanStr = args[0];
            const priority = parseInt(args[1]);

            if (priority % 4096 !== 0) {
                return { output: ['% Priority must be in increments of 4096'] };
            }

            const sw = getSwitch(context.device);
            if (!sw) return { output: ['% Command only valid on switches'] };

            const vlanIds: number[] = [];
            const parts = vlanStr.split(',');
            for (const part of parts) {
                if (part.includes('-')) {
                    const [s, e] = part.split('-').map(Number);
                    if (!isNaN(s) && !isNaN(e)) {
                        for (let i = s; i <= e; i++) vlanIds.push(i);
                    }
                } else {
                    const v = parseInt(part);
                    if (!isNaN(v)) vlanIds.push(v);
                }
            }

            const newStpState = { ...sw.stpState };
            newStpState.vlanConfig = newStpState.vlanConfig || {};

            for (const vid of vlanIds) {
                newStpState.vlanConfig[vid] = {
                    priority,
                    rootType: undefined
                };
            }

            return {
                output: [],
                updateConfig: { stpState: newStpState }
            };
        }
    },
    {
        pattern: /^show\s+spanning-tree(?:\s+vlan\s+(\d+))?$/i,
        modes: ['privileged', 'global-config'],
        help: 'show spanning-tree [vlan <id>]',
        handler: (args, context) => {
            const sw = getSwitch(context.device);
            if (!sw) return { output: ['% Command only valid on switches'] };

            const targetVlan = args[0] ? parseInt(args[0]) : undefined;
            const output: string[] = [];

            const allVlans = sw.vlanDb.map(v => v.id).sort((a, b) => a - b);

            const showVlan = (vid: number) => {
                // Global STP State (CST) used for all VLANs currently (Simplified)
                // In real PVST+, we would look up per-vlan instance.
                // Here we fallback to global stpState for the logic, but filter ports by VLAN.

                const stp = sw.stpState;
                const rootInfo = stp.rootBridgeId ? stp.rootBridgeId.split('-') : [String(stp.priority), sw.macAddress];
                const rootPri = rootInfo[0];
                const rootMac = rootInfo[1];
                const rootCost = stp.rootPathCost ?? 0;
                const rootPortName = stp.rootPortId ? sw.ports.find(p => p.id === stp.rootPortId)?.name || 'Et/0' : '';
                const myPri = stp.priority;

                const isRoot = stp.rootBridgeId === `${String(myPri).padStart(6, '0')}-${sw.macAddress}`;

                output.push(`VLAN${String(vid).padStart(4, '0')}`);
                output.push(`  Spanning tree enabled protocol ieee`);
                output.push(`  Root ID    Priority    ${parseInt(rootPri)}`); // Remove padding for display
                output.push(`             Address     ${rootMac}`);
                if (isRoot) {
                    output.push(`             This bridge is the root`);
                } else {
                    output.push(`             Cost        ${rootCost}`);
                    output.push(`             Port        ${rootPortName}`); // Should show port number/name
                }
                output.push(`             Hello Time   2 sec  Max Age 20 sec  Forward Delay 15 sec`);
                output.push('');
                output.push(`  Bridge ID  Priority    ${myPri} (priority ${myPri} sys-id-ext ${vid})`);
                output.push(`             Address     ${sw.macAddress}`);
                output.push('');
                output.push('Interface           Role Sts Cost      Prio.Nbr Type');
                output.push('------------------- ---- --- --------- -------- --------------------------------');

                const ports = sw.ports.filter(p => {
                    if (p.mode === 'access' && p.vlan === vid) return true;
                    if (p.mode === 'trunk') {
                        if (!p.trunkAllowedVlans || p.trunkAllowedVlans.length === 0 || p.trunkAllowedVlans.includes(vid)) return true;
                    }
                    return false;
                });

                // Sort ports by name natural order
                ports.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

                for (const p of ports) {
                    const details = stp.portDetails?.[p.id];
                    // Map Role
                    let roleStr = 'Desg'; // Default
                    if (details?.role === 'root') roleStr = 'Root';
                    else if (details?.role === 'alternate') roleStr = 'Altn';
                    else if (details?.role === 'backup') roleStr = 'Back'; // Typos in types? "backup"
                    else if (details?.role === 'disabled') roleStr = 'Dis ';

                    // Map State
                    let stateStr = 'FWD';
                    if (details?.state === 'blocking') stateStr = 'BLK';
                    else if (details?.state === 'learning') stateStr = 'LRN';
                    else if (details?.state === 'listening') stateStr = 'LIS';
                    else if (details?.state === 'disabled') stateStr = 'DIS';

                    const cost = details?.cost ?? 19;
                    const priNbr = `128.${p.id.substring(0, 4)}`; // Mock Prio.Nbr

                    output.push(`${p.name.padEnd(19)} ${roleStr.padEnd(4)} ${stateStr} ${String(cost).padEnd(9)} ${priNbr.padEnd(8)} P2p`);
                }
                output.push('');
            };

            if (targetVlan) {
                showVlan(targetVlan);
            } else {
                allVlans.forEach(v => showVlan(v));
            }

            return { output };
        }
    },
    {
        pattern: /^ip\s+default-gateway\s+(\d+\.\d+\.\d+\.\d+)$/i,
        modes: ['global-config'],
        help: 'ip default-gateway <ip> (L2)',
        handler: (args, context) => {
            if (context.device.type === 'l2-switch') {
                return { output: [], updateConfig: { ipDefaultGateway: args[0] } as any };
            }
            return { output: ['% Command only valid on L2 Switch'] };
        }
    },

    // ===== VLAN設定 =====
    {
        pattern: /^vlan\s+(\d+)$/i,
        modes: ['global-config'],
        help: 'vlan <id> - Create or modify VLAN',
        handler: (args, context) => {
            const vlanId = parseInt(args[0]);
            if (vlanId < 1 || vlanId > 4094) {
                return { output: ['% Invalid VLAN ID (1-4094)'] };
            }

            const sw = getSwitch(context.device);
            if (!sw) return { output: ['% VLANs not supported on this device'] };

            // VLANが存在しない場合は作成
            if (!sw.vlanDb.find(v => v.id === vlanId)) {
                const newVlan: VlanInfo = {
                    id: vlanId,
                    name: `VLAN${String(vlanId).padStart(4, '0')}`,
                    status: 'active',
                };
                return {
                    output: [],
                    newMode: 'vlan-config',
                    newVlan: vlanId,
                    updateConfig: { vlanDb: [...sw.vlanDb, newVlan] },
                };
            }

            return {
                output: [],
                newMode: 'vlan-config',
                newVlan: vlanId,
            };
        },
    },
    {
        pattern: /^name\s+(.+)$/i,
        modes: ['vlan-config'],
        help: 'name <name> - Set VLAN name',
        handler: (args, context) => {
            const name = args[0];
            if (!context.currentVlan) {
                return { output: ['% No VLAN selected'] };
            }

            const sw = getSwitch(context.device);
            if (!sw) return { output: ['% Invalid device'] };

            const updatedVlans = sw.vlanDb.map(v =>
                v.id === context.currentVlan ? { ...v, name } : v
            );

            return {
                output: [],
                updateConfig: { vlanDb: updatedVlans },
            };
        },
    },
    {
        pattern: /^no\s+vlan\s+(\d+)$/i,
        modes: ['global-config'],
        help: 'no vlan <id> - Delete VLAN',
        handler: (args, context) => {
            const vlanId = parseInt(args[0]);
            if (vlanId === 1) {
                return { output: ['% Cannot delete default VLAN 1'] };
            }

            const sw = getSwitch(context.device);
            if (!sw) return { output: ['% Invalid device'] };

            const updatedVlans = sw.vlanDb.filter(v => v.id !== vlanId);

            return {
                output: [],
                updateConfig: { vlanDb: updatedVlans },
            };
        },
    },

    // ===== ホスト名 =====
    {
        pattern: /^hostname\s+(\S+)$/i,
        modes: ['global-config'],
        help: 'hostname <name> - Set system hostname',
        handler: (args) => {
            const hostname = args[0];
            return {
                output: [],
                updateConfig: { hostname, name: hostname },
            };
        },
    },

    // ===== L3設定（L3スイッチのみ） =====
    {
        pattern: /^ip\s+routing$/i,
        modes: ['global-config'],
        help: 'ip routing - Enable IP routing',
        handler: (_, context) => {
            if (context.device.type !== 'l3-switch') {
                return { output: ['% IP routing not supported on this device'] };
            }
            return {
                output: ['% IP routing is enabled'],
            };
        },
    },
    {
        pattern: /^no\s+ip\s+routing$/i,
        modes: ['global-config'],
        help: 'no ip routing - Disable IP routing',
        handler: (_, context) => {
            if (context.device.type !== 'l3-switch') {
                return { output: ['% IP routing not supported on this device'] };
            }
            return {
                output: ['% IP routing is disabled'],
            };
        },
    },
    {
        pattern: /^ip\s+route\s+(\d+\.\d+\.\d+\.\d+)\s+(\d+\.\d+\.\d+\.\d+)\s+(\d+\.\d+\.\d+\.\d+)$/i,
        modes: ['global-config'],
        help: 'ip route <network> <mask> <next-hop> - Add static route',
        handler: (args, context) => {
            if (context.device.type !== 'l3-switch') {
                return { output: ['% IP routing not supported on this device'] };
            }
            const [network, mask, nextHop] = args;
            const l3 = context.device as L3Switch;

            // ルートを追加
            const newRoute = {
                network,
                mask,
                nextHop,
                interface: '',
                protocol: 'static' as const,
                metric: 1,
            };

            return {
                output: [],
                updateConfig: {
                    routingTable: [...l3.routingTable, newRoute],
                },
            };
        },
    },
    {
        pattern: /^no\s+ip\s+route\s+(\d+\.\d+\.\d+\.\d+)\s+(\d+\.\d+\.\d+\.\d+)\s+(\d+\.\d+\.\d+\.\d+)$/i,
        modes: ['global-config'],
        help: 'no ip route <network> <mask> <next-hop> - Remove static route',
        handler: (args, context) => {
            if (context.device.type !== 'l3-switch') {
                return { output: ['% IP routing not supported on this device'] };
            }
            const [network, mask, nextHop] = args;
            const l3 = context.device as L3Switch;

            const newRoutingTable = l3.routingTable.filter(r =>
                !(r.network === network && r.mask === mask && r.nextHop === nextHop)
            );

            return {
                output: [],
                updateConfig: {
                    routingTable: newRoutingTable,
                },
            };
        },
    },
    {
        pattern: /^no\s+router\s+ospf\s+(\d+)$/i,
        modes: ['global-config'],
        help: 'no router ospf <process-id> - Remove OSPF process',
        handler: (args, context) => {
            if (context.device.type !== 'l3-switch') {
                return { output: ['% IP routing not supported on this device'] };
            }
            const processId = parseInt(args[0]);
            const l3 = context.device as L3Switch;

            if (l3.ospfConfig?.processId === processId) {
                return {
                    output: [],
                    updateConfig: { ospfConfig: undefined } as any // Type assertion needed or update types
                };
            }
            return { output: ['% OSPF process not found'] };
        },
    },
    {
        pattern: /^ip\s+address\s+(\d+\.\d+\.\d+\.\d+)\s+(\d+\.\d+\.\d+\.\d+)$/i,
        modes: ['interface-config'],
        help: 'ip address <ip> <mask> - Set interface IP address',
        handler: (args, context) => {
            if (context.device.type !== 'l3-switch') {
                return { output: ['% IP routing not supported on this device'] };
            }

            const [ip, mask] = args;
            return { output: [`% IP address ${ip} ${mask} configured on ${context.currentInterface}`] };
        },
    },

    // ===== showコマンド =====
    {
        pattern: /^sh(?:ow)?\s+ru(?:n(?:ning-config)?)?(?:\s+int(?:erface)?(?:\s+(.+))?)?$/i,
        modes: ['privileged', 'global-config', 'interface-config', 'vlan-config'],
        help: 'show running-config [interface <name>] - Display current configuration',
        handler: (args, context) => {
            const sw = getSwitch(context.device);
            if (!sw) return { output: ['% Not supported'] };

            // args[0] might be the interface name if "int" or "interface" was used
            const targetIfName = args[0]?.trim();

            const isL3 = context.device.type === 'l3-switch';
            const timestamp = new Date().toLocaleString('en-US', {
                weekday: 'short', month: 'short', day: 'numeric',
                hour: '2-digit', minute: '2-digit', second: '2-digit', year: 'numeric'
            });

            // If a specific interface is requested, we only return that section
            if (targetIfName) {
                const port = findPort(context.device, targetIfName);
                if (!port) return { output: [`% Interface ${targetIfName} not found`] };

                const section: string[] = [`interface ${port.name}`];
                if (port.status === 'admin-down') section.push(' shutdown');

                const isSvi = port.name.toLowerCase().startsWith('vlan');
                if (isSvi) {
                    if (port.ipAddress) section.push(` ip address ${port.ipAddress} ${port.subnetMask}`);
                    else section.push(' no ip address');

                    if (isL3) {
                        const l3 = sw as L3Switch;
                        const vid = parseInt(port.name.replace(/\D/g, ''));
                        const hsrp = l3.hsrpGroups.filter(g => g.group === vid);
                        for (const h of hsrp) {
                            section.push(` standby ${h.group} ip ${h.virtualIp}`);
                            if (h.priority !== 100) section.push(` standby ${h.group} priority ${h.priority}`);
                            if (h.preempt) section.push(` standby ${h.group} preempt`);
                        }
                    }
                } else {
                    if (port.mode === 'routed') {
                        section.push(' no switchport');
                        if (port.ipAddress) section.push(` ip address ${port.ipAddress} ${port.subnetMask}`);
                    } else if (port.mode === 'trunk') {
                        section.push(' switchport trunk encapsulation dot1q');
                        section.push(' switchport mode trunk');
                        if (port.trunkAllowedVlans && port.trunkAllowedVlans.length > 0) {
                            section.push(` switchport trunk allowed vlan ${port.trunkAllowedVlans.join(',')}`);
                        }
                    } else if (port.mode === 'access') {
                        section.push(' switchport mode access');
                        if (port.vlan && port.vlan !== 1) section.push(` switchport access vlan ${port.vlan}`);
                    }
                    if (port.channelGroup) section.push(` channel-group ${port.channelGroup} mode active`);
                    section.push(' spanning-tree portfast');
                }
                section.push('!');
                return { output: section };
            }

            // Normal full running-config
            const config: string[] = [
                'Building configuration...',
                '',
                `Current configuration : ${Math.floor(Math.random() * 5000) + 2000} bytes`,
                '!',
                `! Last configuration change at ${timestamp}`,
                '!',
                'version 15.2',
                `service timestamps debug datetime msec`,
                `service timestamps log datetime msec`,
                'service password-encryption',
                '!',
                `hostname ${sw.hostname}`,
                '!',
                'boot-start-marker',
                'boot-end-marker',
                '!',
                'enable secret 5 $1$xxxx$xxxxxxxxxxxxxxxxxxxxxxxxxx',
                '!',
                'no aaa new-model',
                '!',
            ];

            // Global L3 settings
            if (isL3) {
                config.push('ip routing');
                config.push('!');
                config.push('ip CEF'); // Using standard CEF capitalization
                config.push('!');
            }
            config.push('no ip domain-lookup');
            config.push('!');

            // Global STP
            config.push(`spanning-tree mode ${sw.stpState.mode}`);
            config.push('spanning-tree extend system-id');
            if (sw.stpState.priority !== 32768) {
                config.push(`spanning-tree vlan 1-4094 priority ${sw.stpState.priority}`);
            }
            if (sw.stpState.vlanConfig) {
                for (const [vid, conf] of Object.entries(sw.stpState.vlanConfig)) {
                    config.push(`spanning-tree vlan ${vid} priority ${conf.priority}`);
                }
            }
            config.push('!');

            // VLAN Database
            for (const vlan of sw.vlanDb) {
                config.push(`vlan ${vlan.id}`);
                config.push(` name ${vlan.name}`);
                if (vlan.status !== 'active') {
                    config.push(` state suspend`);
                }
            }
            config.push('!');

            // Interfaces (Physical & SVIs from ports)
            const sortPorts = (a: any, b: any) => {
                const typeScore = (name: string) => {
                    if (name.startsWith('Fast')) return 1;
                    if (name.startsWith('Gig')) return 2;
                    if (name.startsWith('Ten')) return 3;
                    if (name.startsWith('Port')) return 4;
                    if (name.startsWith('Vlan')) return 5;
                    return 0;
                };
                const ta = typeScore(a.name);
                const tb = typeScore(b.name);
                if (ta !== tb) return ta - tb;
                return a.name.localeCompare(b.name, undefined, { numeric: true });
            };

            const sortedPorts = [...sw.ports].sort(sortPorts);

            for (const port of sortedPorts) {
                config.push(`interface ${port.name}`);
                if (port.status === 'admin-down') config.push(' shutdown');

                const isSvi = port.name.toLowerCase().startsWith('vlan');
                if (isSvi) {
                    if (port.ipAddress) config.push(` ip address ${port.ipAddress} ${port.subnetMask}`);
                    else config.push(' no ip address');

                    if (isL3) {
                        const l3 = sw as L3Switch;
                        const vid = parseInt(port.name.replace(/\D/g, ''));
                        const hsrp = l3.hsrpGroups.filter(g => g.group === vid);
                        for (const h of hsrp) {
                            config.push(` standby ${h.group} ip ${h.virtualIp}`);
                            if (h.priority !== 100) config.push(` standby ${h.group} priority ${h.priority}`);
                            if (h.preempt) config.push(` standby ${h.group} preempt`);
                        }
                    }
                } else {
                    if (port.mode === 'routed') {
                        config.push(' no switchport');
                        if (port.ipAddress) config.push(` ip address ${port.ipAddress} ${port.subnetMask}`);
                    } else if (port.mode === 'trunk') {
                        config.push(' switchport trunk encapsulation dot1q');
                        config.push(' switchport mode trunk');
                        if (port.trunkAllowedVlans && port.trunkAllowedVlans.length > 0) {
                            config.push(` switchport trunk allowed vlan ${port.trunkAllowedVlans.join(',')}`);
                        }
                    } else if (port.mode === 'access') {
                        config.push(' switchport mode access');
                        if (port.vlan && port.vlan !== 1) config.push(` switchport access vlan ${port.vlan}`);
                    }
                    if (port.channelGroup) config.push(` channel-group ${port.channelGroup} mode active`);
                    config.push(' spanning-tree portfast');
                }
                config.push('!');
            }

            // Default Gateway (L2)
            if (!isL3 && (sw as L2Switch).ipDefaultGateway) {
                config.push(`ip default-gateway ${(sw as L2Switch).ipDefaultGateway}`);
            }

            // Routing (L3)
            if (isL3) {
                const l3 = sw as L3Switch;
                if (l3.routingTable.length > 0) {
                    const staticRoutes = l3.routingTable.filter(r => r.protocol === 'static');
                    for (const route of staticRoutes) {
                        config.push(`ip route ${route.network} ${route.mask} ${route.nextHop}`);
                    }
                    config.push('!');
                }
                if (l3.ospfConfig) {
                    config.push(`router ospf ${l3.ospfConfig.processId}`);
                    for (const net of l3.ospfConfig.networks) {
                        config.push(` network ${net.network} ${net.wildcard} area ${net.area}`);
                    }
                    config.push('!');
                }
            }

            // Console lines
            config.push('line con 0');
            config.push(' logging synchronous');
            config.push(' login');
            config.push('line vty 0 4');
            config.push(' login');
            config.push(' transport input ssh');
            config.push('line vty 5 15');
            config.push(' login');
            config.push(' transport input ssh');
            config.push('!');
            config.push('end');

            return { output: config };
        },
    },
    {
        pattern: /^sh(?:ow)?\s+vlan(?:\s+brief)?$/i,
        modes: ['privileged', 'global-config'],
        help: 'show vlan brief - Display VLAN information',
        handler: (_, context) => {
            const sw = getSwitch(context.device);
            if (!sw) return { output: ['% VLANs not supported'] };

            return { output: formatVlanTable(sw.vlanDb) };
        },
    },
    {
        pattern: /^sh(?:ow)?\s+int(?:erfaces?)?\s+d(?:es(?:c(?:ription)?)?)?$/i,
        modes: ['privileged', 'global-config'],
        help: 'show interfaces description - Display interface description',
        handler: (_, context) => {
            return { output: formatInterfaceDescription(context.device) };
        },
    },
    {
        pattern: /^sh(?:ow)?\s+ip\s+int(?:erface)?\s+brief$/i,
        modes: ['privileged', 'global-config'],
        help: 'show ip interface brief - Display interface status',
        handler: (_, context) => {
            const sw = context.device;
            const output: string[] = [
                'Interface              IP-Address      OK? Method Status                Protocol',
            ];

            // Helper to determine status/protocol (Cisco style logic)
            // If admin down -> Status: administratively down, Protocol: down
            // If up (connected) -> Status: up, Protocol: up
            // If down (not connected) -> Status: down, Protocol: down
            const getStatusLine = (port: any) => {
                const name = port.name.padEnd(22);
                let ip = 'unassigned';
                let method = 'unset';

                if (port.ipAddress) {
                    ip = port.ipAddress;
                    method = 'manual';
                }

                const ok = 'YES';

                let statusStr = 'down';
                let protoStr = 'down';

                if (port.status === 'admin-down') {
                    statusStr = 'administratively down';
                    protoStr = 'down';
                } else if (port.status === 'up') {
                    statusStr = 'up';
                    protoStr = 'up';
                }

                return `${name} ${ip.padEnd(15)} ${ok} ${method.padEnd(6)} ${statusStr.padEnd(21)} ${protoStr}`;
            };

            // Sort ports
            const sortPorts = (a: any, b: any) => {
                const typeScore = (name: string) => {
                    if (name.startsWith('Fast')) return 1;
                    if (name.startsWith('Gig')) return 2;
                    if (name.startsWith('Ten')) return 3;
                    if (name.startsWith('Port')) return 4;
                    if (name.startsWith('Vlan')) return 5;
                    return 0;
                };
                const ta = typeScore(a.name);
                const tb = typeScore(b.name);
                if (ta !== tb) return ta - tb;
                return a.name.localeCompare(b.name, undefined, { numeric: true });
            };

            const sortedPorts = [...sw.ports].sort(sortPorts);

            for (const port of sortedPorts) {
                output.push(getStatusLine(port));
            }

            return { output };
        },
    },
    {
        pattern: /^sh(?:ow)?\s+ip\s+route$/i,
        modes: ['privileged', 'global-config'],
        help: 'show ip route - Display IP routing table',
        handler: (_, context) => {
            if (context.device.type !== 'l3-switch') {
                return { output: ['% IP routing not enabled'] };
            }

            const l3 = context.device as L3Switch;
            const output: string[] = [
                'Codes: L - local, C - connected, S - static, R - RIP, M - mobile, B - BGP',
                '       D - EIGRP, EX - EIGRP external, O - OSPF, IA - OSPF inter area',
                '       N1 - OSPF NSSA external type 1, N2 - OSPF NSSA external type 2',
                '       E1 - OSPF external type 1, E2 - OSPF external type 2',
                '       i - IS-IS, su - IS-IS summary, L1 - IS-IS level-1, L2 - IS-IS level-2',
                '       ia - IS-IS inter area, * - candidate default, U - per-user static route',
                '       o - ODR, P - periodic downloaded static route, H - NHRP, l - LISP',
                '       a - application route',
                '       + - replicated route, % - next hop override, p - overrides from PfR',
                '',
                'Gateway of last resort is not set',
                '',
            ];

            // デフォルトの接続ルート
            output.push('      192.168.1.0/24 is variably subnetted, 2 subnets, 2 masks');
            output.push('C        192.168.1.0/24 is directly connected, Vlan1');
            output.push('L        192.168.1.1/32 is directly connected, Vlan1');

            // スタティックルート
            for (const route of l3.routingTable) {
                const code = route.protocol === 'static' ? 'S' :
                    route.protocol === 'connected' ? 'C' :
                        route.protocol === 'ospf' ? 'O' : 'D';
                const network = `${route.network}/${route.mask}`;
                if (route.protocol === 'static') {
                    output.push(`${code}        ${network} [1/0] via ${route.nextHop}`);
                } else if (route.protocol === 'connected') {
                    output.push(`${code}        ${network} is directly connected, ${route.interface}`);
                } else if (route.protocol === 'ospf') {
                    output.push(`${code}        ${network} [110/${route.metric}] via ${route.nextHop}, ${route.interface}`);
                } else if (route.protocol === 'bgp') {
                    output.push(`${code}        ${network} [20/${route.metric}] via ${route.nextHop}, ${route.interface}`);
                }
            }

            return { output };
        },
    },
    {
        pattern: /^sh(?:ow)?\s+etherchannel\s+summary$/i,
        modes: ['privileged', 'global-config'],
        help: 'show etherchannel summary - Display EtherChannel status',
        handler: (_, context) => {
            const sw = getSwitch(context.device);
            if (!sw) return { output: ['% Not supported'] };

            const output: string[] = [
                'Flags:  D - down        P - bundled in port-channel',
                '        I - stand-alone s - suspended',
                '        H - Hot-standby (LACP only)',
                '        R - Layer3      S - Layer2',
                '        U - in use      f - failed to allocate aggregator',
                '',
                '        M - not in use, minimum links not met',
                '        u - unsuitable for bundling',
                '        w - waiting to be aggregated',
                '        d - default port',
                '',
                '',
                'Number of channel-groups in use: 0',
                'Number of aggregators:           0',
                '',
                'Group  Port-channel  Protocol    Ports',
                '------+-------------+-----------+-----------------------------------------------',
                '',
                '% No EtherChannel groups configured',
            ];

            return { output };
        },
    },
    {
        pattern: /^sh(?:ow)?\s+mac\s+address-table$/i,
        modes: ['privileged', 'global-config'],
        help: 'show mac address-table - Display MAC address table',
        handler: (_, context) => {
            const sw = getSwitch(context.device);
            if (!sw) return { output: ['% Not supported'] };
            return { output: formatMacAddressTable(sw) };
        },
    },
    {
        pattern: /^sh(?:ow)?\s+cdp\s+nei(?:ghbors)?$/i,
        modes: ['privileged', 'global-config'],
        help: 'show cdp neighbors - Display CDP neighbors',
        handler: (_, context) => {
            const myDev = context.device;
            const conns = context.allConnections.filter(c =>
                (c.sourceDeviceId === myDev.id && c.status === 'up') ||
                (c.targetDeviceId === myDev.id && c.status === 'up')
            );

            if (conns.length === 0) {
                return { output: [] };
            }

            const output: string[] = [
                `Capability Codes: R - Router, T - Trans Bridge, B - Source Route Bridge`,
                `                  S - Switch, H - Host, I - IGMP, r - Repeater, P - Phone`,
                `                  D - Remote, C - CVTA, M - Two-port Mac Relay`,
                ``,
                `Device ID        Local Intrfce     Holdtme    Capability  Platform  Port ID`,
            ];

            for (const c of conns) {
                const isSource = c.sourceDeviceId === myDev.id;
                const neighborId = isSource ? c.targetDeviceId : c.sourceDeviceId;
                const myPortId = isSource ? c.sourcePortId : c.targetPortId;
                const neighborPortId = isSource ? c.targetPortId : c.sourcePortId;

                const neighbor = context.allDevices.find(d => d.id === neighborId);
                const myPort = myDev.ports.find(p => p.id === myPortId);
                const neighborPort = neighbor?.ports.find(p => p.id === neighborPortId);

                if (neighbor && myPort && neighborPort) {
                    const devId = neighbor.hostname;
                    // Format interface names to short (Gig 1/0/1)
                    const localInt = myPort.name.replace('Gi1/0/', 'Gig 1/0/').replace('Fa1/0/', 'Fas 1/0/');
                    const holdTime = '120';

                    let caps = '';
                    if (neighbor.type === 'l3-switch') caps = 'R S I';
                    else if (neighbor.type === 'l2-switch') caps = 'S I';
                    else if (neighbor.type === 'pc') caps = 'H';

                    const platform = neighbor.type === 'l3-switch' ? 'C3750' : (neighbor.type === 'l2-switch' ? 'C2960' : 'Linux');
                    const portId = neighborPort.name.replace('Gi1/0/', 'Gig 1/0/').replace('Fa1/0/', 'Fas 1/0/');

                    // Pad logic
                    // DeviceID (17) LocalInt (14) Hold (10) Cap (10) Plat (9) Port
                    const line = `${devId.padEnd(16)} ${localInt.padEnd(13)} ${holdTime.padEnd(9)} ${caps.padEnd(9)} ${platform.padEnd(9)} ${portId}`;
                    output.push(line);
                }
            }
            output.push('');
            return { output };
        },
    },
    {
        pattern: /^sh(?:ow)?\s+arp$/i,
        modes: ['privileged', 'global-config'],
        help: 'show arp - Display ARP table',
        handler: (_, context) => {
            if (context.device.type !== 'l3-switch') {
                return { output: ['% ARP not supported on L2 switch'] };
            }
            return { output: formatArpTable(context.device as L3Switch) };
        },
    },
    {
        pattern: /^sh(?:ow)?\s+ver(?:sion)?$/i,
        modes: ['privileged', 'global-config', 'user'],
        help: 'show version - Display system version',
        handler: (_, context) => {
            const isL3 = context.device.type === 'l3-switch';
            const model = isL3 ? 'WS-C3750X-24T-S' : 'WS-C2960X-24TS-L';
            const softwareModel = isL3 ? 'C3750E' : 'C2960X';
            const uptime = Math.floor(Math.random() * 10);
            const hours = Math.floor(Math.random() * 24);
            const minutes = Math.floor(Math.random() * 60);

            return {
                output: [
                    `Cisco IOS Software, ${softwareModel} Software (${softwareModel}-UNIVERSALK9-M), Version 15.2(7)E3, RELEASE SOFTWARE (fc3)`,
                    'Technical Support: http://www.cisco.com/techsupport',
                    'Copyright (c) 1986-2024 by Cisco Systems, Inc.',
                    'Compiled Wed 01-Jan-25 12:00 by prod_rel_team',
                    '',
                    `ROM: Bootstrap program is ${softwareModel} boot loader`,
                    `BOOTLDR: ${softwareModel} Boot Loader (${softwareModel}-HBOOT-M) Version 15.2(7r)E3, RELEASE SOFTWARE (fc3)`,
                    '',
                    `${context.device.hostname} uptime is ${uptime} days, ${hours} hours, ${minutes} minutes`,
                    'System returned to ROM by power-on',
                    'System restarted at 00:00:00 UTC Mon Jan 1 2025',
                    'System image file is "flash:/${softwareModel}-universalk9-mz.152-7.E3.bin"',
                    'Last reload reason: Power Failure or Unknown',
                    '',
                    '',
                    'This product contains cryptographic features and is subject to United',
                    'States and local country laws governing import, export, transfer and',
                    'use. Delivery of Cisco cryptographic products does not imply',
                    'third-party authority to import, export, distribute or use encryption.',
                    '',
                    'LICENSE LEVEL: ipservices',
                    '',
                    `cisco ${model} (PowerPC405) processor with 262144K bytes of memory.`,
                    'Processor board ID FOC1234X567',
                    'Last reset from power-on',
                    `${context.device.ports.length} Gigabit Ethernet interfaces`,
                    isL3 ? '1 Virtual Ethernet interface' : '',
                    'The password-recovery mechanism is enabled.',
                    '',
                    '512K bytes of flash-simulated non-volatile configuration memory.',
                    `Base ethernet MAC Address       : ${(context.device as any).macAddress}`,
                    'Motherboard assembly number     : 73-12345-06',
                    'Power supply part number        : 341-0345-02',
                    'Motherboard serial number       : FOC12345678',
                    'Power supply serial number      : DCB1234A567',
                    'Model revision number           : A0',
                    'Motherboard revision number     : A0',
                    `Model number                    : ${model}`,
                    'System serial number            : FOC1234X567',
                    'Top Assembly Part Number        : 800-30234-04',
                    'Top Assembly Revision Number    : B0',
                    '',
                    `Configuration register is 0x${(0x2102).toString(16).toUpperCase()}`,
                ].filter(line => line !== ''),
            };
        },
    },
    {
        pattern: /^sh(?:ow)?\s+int(?:erfaces)?$/i,
        modes: ['privileged', 'global-config'],
        help: 'show interfaces - Display interface details',
        handler: (_, context) => {
            const output: string[] = [];
            const generateMac = () => {
                const hex = () => Math.floor(Math.random() * 256).toString(16).padStart(2, '0');
                return `${hex()}${hex()}.${hex()}${hex()}.${hex()}${hex()}`;
            };

            for (const port of context.device.ports.slice(0, 3)) {
                const isUp = port.status === 'up';
                const isAdminDown = port.status === 'admin-down';
                const statusText = isAdminDown ? 'administratively down' : (isUp ? 'up' : 'down');
                const protocolText = isUp ? 'up' : 'down';
                const macAddr = generateMac();

                output.push(`${port.name} is ${statusText}, line protocol is ${protocolText}`);
                output.push(`  Hardware is Gigabit Ethernet, address is ${macAddr} (bia ${macAddr})`);
                output.push(`  Description:`);
                output.push(`  MTU 1500 bytes, BW 1000000 Kbit/sec, DLY 10 usec,`);
                output.push(`     reliability 255/255, txload 1/255, rxload 1/255`);
                output.push(`  Encapsulation ARPA, loopback not set`);
                output.push(`  Keepalive set (10 sec)`);
                output.push(`  Full-duplex, 1000Mb/s, media type is 10/100/1000BaseTX`);
                output.push(`  input flow-control is off, output flow-control is unsupported`);
                output.push(`  ARP type: ARPA, ARP Timeout 04:00:00`);
                output.push(`  Last input ${isUp ? '00:00:00' : 'never'}, output ${isUp ? '00:00:00' : 'never'}, output hang never`);
                output.push(`  Last clearing of "show interface" counters never`);
                output.push(`  Input queue: 0/75/0/0 (size/max/drops/flushes); Total output drops: 0`);
                output.push(`  Queueing strategy: fifo`);
                output.push(`  Output queue: 0/40 (size/max)`);
                output.push(`  5 minute input rate 0 bits/sec, 0 packets/sec`);
                output.push(`  5 minute output rate 0 bits/sec, 0 packets/sec`);
                output.push(`     ${isUp ? Math.floor(Math.random() * 10000) : 0} packets input, ${isUp ? Math.floor(Math.random() * 1000000) : 0} bytes, 0 no buffer`);
                output.push(`     Received 0 broadcasts (0 multicasts)`);
                output.push(`     0 runts, 0 giants, 0 throttles`);
                output.push(`     0 input errors, 0 CRC, 0 frame, 0 overrun, 0 ignored`);
                output.push(`     0 watchdog, 0 multicast, 0 pause input`);
                output.push(`     0 input packets with dribble condition detected`);
                output.push(`     ${isUp ? Math.floor(Math.random() * 10000) : 0} packets output, ${isUp ? Math.floor(Math.random() * 1000000) : 0} bytes, 0 underruns`);
                output.push(`     0 output errors, 0 collisions, 1 interface resets`);
                output.push(`     0 unknown protocol drops`);
                output.push(`     0 babbles, 0 late collision, 0 deferred`);
                output.push(`     0 lost carrier, 0 no carrier, 0 pause output`);
                output.push(`     0 output buffer failures, 0 output buffers swapped out`);
                output.push('');
            }
            output.push(`... (${context.device.ports.length - 3} more interfaces, use 'show interfaces \u003cname\u003e' for details)`);
            return { output };
        },
    },
    {
        pattern: /^sh(?:ow)?\s+int(?:erfaces)?\s+trunk$/i,
        modes: ['privileged', 'global-config'],
        help: 'show interfaces trunk - Display trunk interface information',
        handler: (_, context) => {
            const output: string[] = [];
            const ports = context.device.ports.filter(p => p.mode === 'trunk');

            if (ports.length === 0) {
                return { output: [] }; // No trunk ports
            }

            output.push('');
            output.push('Port        Mode             Encapsulation  Status        Native vlan');
            for (const port of ports) {
                const status = port.status === 'up' ? 'trunking' : 'not-trunking';
                output.push(`${port.name.padEnd(12)}on               802.1q         ${status.padEnd(14)}1`);
            }

            output.push('');
            output.push('Port        Vlans allowed on trunk');
            for (const port of ports) {
                const vlans = port.trunkAllowedVlans && port.trunkAllowedVlans.length > 0
                    ? port.trunkAllowedVlans.join(',')
                    : '1-4094';
                output.push(`${port.name.padEnd(12)}${vlans}`);
            }

            output.push('');
            output.push('Port        Vlans allowed and active in management domain');
            for (const port of ports) {
                const vlans = port.trunkAllowedVlans && port.trunkAllowedVlans.length > 0
                    ? port.trunkAllowedVlans.join(',')
                    : '1,10,20'; // 簡易表示
                output.push(`${port.name.padEnd(12)}${vlans}`);
            }

            output.push('');
            output.push('Port        Vlans in spanning tree forwarding state and not pruned');
            for (const port of ports) {
                const vlans = port.trunkAllowedVlans && port.trunkAllowedVlans.length > 0
                    ? port.trunkAllowedVlans.join(',')
                    : '1,10,20'; // 簡易表示
                output.push(`${port.name.padEnd(12)}${vlans}`);
            }

            return { output };
        },
    },
    {
        pattern: /^sh(?:ow)?\s+etherchannel\s+summary$/i,
        modes: ['privileged', 'global-config'],
        help: 'show etherchannel summary - Display EtherChannel summary',
        handler: (_, context) => {
            const device = context.device;
            if (device.type !== 'l2-switch' && device.type !== 'l3-switch') {
                return { output: ['% command not supported on this device'] };
            }

            const sw = device as any; // Cast to access etherChannels if present
            const channels = sw.etherChannels || [];

            const output: string[] = [
                'Flags:  D - down        P - bundled in port-channel',
                '        I - stand-alone s - suspended',
                '        H - Hot-standby (LACP only)',
                '        R - Layer3      S - Layer2',
                '        U - in use      f - failed to allocate aggregator',
                '',
                '        M - not in use, minimum links not met',
                '        u - unsuitable for bundling',
                '        w - waiting to be aggregated',
                '        d - default port',
                '',
                `Number of channel-groups in use: ${channels.length}`,
                `Number of aggregators:           ${channels.length}`,
                '',
                'Group  Port-channel  Protocol  Ports',
                '------+-------------+-----------+-----------------------------------------------'
            ];

            for (const ch of channels) {
                const poInterface = device.ports.find(p => p.name === `Port-channel${ch.id}` || p.name === `Po${ch.id}`);
                const layerFlag = 'S'; // Default to L2
                const statusFlag = poInterface && poInterface.status === 'up' ? 'U' : 'D';
                const poName = `Po${ch.id}(${layerFlag}${statusFlag})`;
                const protocol = ch.protocol === 'lacp' ? 'LACP' : (ch.protocol === 'pagp' ? 'PAgP' : '-');

                // メンバーポートの表示
                const members = device.ports
                    .filter(p => p.channelGroup === ch.id)
                    .map(p => `${p.name}(P)`) // 簡易的に(P)とする
                    .join('    ');

                output.push(`${String(ch.id).padEnd(7)}${poName.padEnd(14)}${protocol.padEnd(10)}${members}`);
            }

            return { output };
        },
    },

    // ===== HSRP設定（L3スイッチのみ） =====
    {
        pattern: /^standby\s+(\d+)\s+ip\s+(\d+\.\d+\.\d+\.\d+)$/i,
        modes: ['interface-config'],
        help: 'standby <group> ip <virtual-ip> - Configure HSRP virtual IP',
        handler: (args, context) => {
            if (context.device.type !== 'l3-switch') {
                return { output: ['% HSRP not supported on this device'] };
            }

            const group = parseInt(args[0]);
            const virtualIp = args[1];
            const l3 = context.device as L3Switch;

            // 既存グループを探すか新規作成
            let hsrpGroups = [...l3.hsrpGroups];
            const existingIndex = hsrpGroups.findIndex(h => h.group === group);

            if (existingIndex >= 0) {
                hsrpGroups[existingIndex] = {
                    ...hsrpGroups[existingIndex],
                    virtualIp,
                    state: 'listen', // 設定時はListenから開始
                };
            } else {
                hsrpGroups.push({
                    group,
                    state: 'listen',
                    priority: 100,
                    preempt: false,
                    virtualIp,
                    helloTimer: 3,
                    holdTimer: 10,
                });
            }

            return {
                output: [],
                updateConfig: { hsrpGroups },
            };
        },
    },
    {
        pattern: /^no\s+standby\s+(\d+)\s+ip(?:\s+(\d+\.\d+\.\d+\.\d+))?$/i,
        modes: ['interface-config'],
        help: 'no standby <group> ip - Remove HSRP group IP',
        handler: (args, context) => {
            if (context.device.type !== 'l3-switch') return { output: ['% HSRP not supported on this device'] };
            const group = parseInt(args[0]);
            const l3 = context.device as L3Switch;

            // In our simulation, removing IP effectively deletes the group config
            const hsrpGroups = l3.hsrpGroups.filter(h => h.group !== group);

            return {
                output: [],
                updateConfig: { hsrpGroups },
            };
        },
    },
    {
        pattern: /^standby\s+(\d+)\s+priority\s+(\d+)$/i,
        modes: ['interface-config'],
        help: 'standby <group> priority <value> - Set HSRP priority (1-255)',
        handler: (args, context) => {
            if (context.device.type !== 'l3-switch') {
                return { output: ['% HSRP not supported on this device'] };
            }

            const group = parseInt(args[0]);
            const priority = parseInt(args[1]);

            if (priority < 1 || priority > 255) {
                return { output: ['% Priority must be between 1 and 255'] };
            }

            const l3 = context.device as L3Switch;
            const hsrpGroups = l3.hsrpGroups.map(h =>
                h.group === group ? { ...h, priority } : h
            );

            if (!hsrpGroups.find(h => h.group === group)) {
                return { output: [`% HSRP group ${group} not configured`] };
            }

            return {
                output: [],
                updateConfig: { hsrpGroups },
            };
        },
    },
    {
        pattern: /^no\s+standby\s+(\d+)\s+priority$/i,
        modes: ['interface-config'],
        help: 'no standby <group> priority - Reset HSRP priority to default (100)',
        handler: (args, context) => {
            if (context.device.type !== 'l3-switch') return { output: ['% HSRP not supported on this device'] };
            const group = parseInt(args[0]);
            const l3 = context.device as L3Switch;

            const existingIdx = l3.hsrpGroups.findIndex(g => g.group === group);
            if (existingIdx === -1) return { output: ['% HSRP group not found'] };

            const hsrpGroups = [...l3.hsrpGroups];
            hsrpGroups[existingIdx] = { ...hsrpGroups[existingIdx], priority: 100 };

            return {
                output: [],
                updateConfig: { hsrpGroups },
            };
        },
    },
    {
        pattern: /^standby\s+(\d+)\s+preempt$/i,
        modes: ['interface-config'],
        help: 'standby <group> preempt - Enable HSRP preemption',
        handler: (args, context) => {
            if (context.device.type !== 'l3-switch') {
                return { output: ['% HSRP not supported on this device'] };
            }

            const group = parseInt(args[0]);
            const l3 = context.device as L3Switch;
            const hsrpGroups = l3.hsrpGroups.map(h =>
                h.group === group ? { ...h, preempt: true } : h
            );

            if (!hsrpGroups.find(h => h.group === group)) {
                return { output: [`% HSRP group ${group} not configured`] };
            }

            return {
                output: [],
                updateConfig: { hsrpGroups },
            };
        },
    },
    {
        pattern: /^no\s+standby\s+(\d+)\s+preempt$/i,
        modes: ['interface-config'],
        help: 'no standby <group> preempt - Disable HSRP preemption',
        handler: (args, context) => {
            if (context.device.type !== 'l3-switch') {
                return { output: ['% HSRP not supported on this device'] };
            }

            const group = parseInt(args[0]);
            const l3 = context.device as L3Switch;
            const hsrpGroups = l3.hsrpGroups.map(h =>
                h.group === group ? { ...h, preempt: false } : h
            );

            return {
                output: [],
                updateConfig: { hsrpGroups },
            };
        },
    },
    {
        pattern: /^sh(?:ow)?\s+standby$/i,
        modes: ['privileged', 'global-config'],
        help: 'show standby - Display HSRP information',
        handler: (_, context) => {
            if (context.device.type !== 'l3-switch') {
                return { output: ['% HSRP not supported on this device'] };
            }

            const l3 = context.device as L3Switch;
            if (l3.hsrpGroups.length === 0) {
                return { output: ['% HSRP is not configured'] };
            }

            const output: string[] = [];
            for (const hsrp of l3.hsrpGroups) {
                const stateNames: Record<string, string> = {
                    'init': 'Init', 'learn': 'Learn', 'listen': 'Listen',
                    'speak': 'Speak', 'standby': 'Standby', 'active': 'Active'
                };
                const groupHex = hsrp.group.toString(16).padStart(2, '0');
                const virtualMac = `00:00:0C:07:AC:${groupHex}`.toUpperCase();

                output.push(`Vlan1 - Group ${hsrp.group}`);
                output.push(`  State is ${stateNames[hsrp.state] || hsrp.state}`);
                output.push(`  Virtual IP address is ${hsrp.virtualIp || 'not configured'}`);
                output.push(`  Active virtual MAC address is ${virtualMac}`);
                output.push(`  Hello time ${hsrp.helloTimer} sec, hold time ${hsrp.holdTimer} sec`);
                output.push(`  Preemption ${hsrp.preempt ? 'enabled' : 'disabled'}`);
                output.push(`  Priority ${hsrp.priority}${hsrp.priority === 100 ? ' (default)' : ''}`);
                output.push('');
            }

            return { output };
        },
    },
    {
        pattern: /^sh(?:ow)?\s+standby\s+brief$/i,
        modes: ['privileged', 'global-config'],
        help: 'show standby brief - Display HSRP summary',
        handler: (_, context) => {
            if (context.device.type !== 'l3-switch') {
                return { output: ['% HSRP not supported on this device'] };
            }

            const l3 = context.device as L3Switch;
            if (l3.hsrpGroups.length === 0) {
                return { output: ['% HSRP is not configured'] };
            }

            const stateNames: Record<string, string> = {
                'init': 'Init', 'learn': 'Learn', 'listen': 'Listen',
                'speak': 'Speak', 'standby': 'Standby', 'active': 'Active'
            };

            const output: string[] = [
                '',
                '                     P indicates configured to preempt.',
                '                     |',
                'Interface   Grp  Pri P State   Active          Standby         Virtual IP',
            ];

            for (const hsrp of l3.hsrpGroups) {
                const preemptFlag = hsrp.preempt ? 'P' : ' ';
                const stateStr = (stateNames[hsrp.state] || hsrp.state).padEnd(7);
                const active = hsrp.state === 'active' ? 'local' : 'unknown';
                const standby = hsrp.state === 'standby' ? 'local' : 'unknown';

                output.push(
                    `${'Vlan1'.padEnd(12)}${String(hsrp.group).padStart(3)}  ${String(hsrp.priority).padStart(3)} ${preemptFlag} ${stateStr} ${active.padEnd(15)} ${standby.padEnd(15)} ${hsrp.virtualIp}`
                );
            }

            return { output };
        },
    },



    // ===== 接続性検証 =====
    {
        pattern: /^ping\s+(\d+\.\d+\.\d+\.\d+)$/i,
        modes: ['privileged', 'global-config'],
        help: 'ping <ip> - Send ICMP ECHO_REQUEST packets',
        handler: (args, context) => {
            if (context.device.type !== 'l3-switch') {
                return { output: ['% Ping not supported on this device'] };
            }

            const targetIp = args[0];
            let result = checkConnectivity(
                context.allDevices,
                context.allConnections,
                context.device.id,
                targetIp
            );

            const output = ['Type escape sequence to abort.', `Sending 5, 100-byte ICMP Echos to ${targetIp}, timeout is 2 seconds:`];

            let updateConfig = undefined;
            let displayRtt: number[] = result.rtt;
            let displayString = '';

            // ARP Miss Handling (Simulate .!!!!)
            if (result.arpUpdates && result.arpUpdates.length > 0 && context.device.type === 'l3-switch') {
                const l3 = context.device as L3Switch;
                const newEntries = result.arpUpdates.map(u => u.entry);
                // Filter duplicates
                const mergedArp = [...l3.arpTable];
                for (const entry of newEntries) {
                    if (!mergedArp.some(e => e.ipAddress === entry.ipAddress)) {
                        mergedArp.push(entry);
                    }
                }
                updateConfig = { arpTable: mergedArp };

                // Simulate 1 drop, 4 success
                displayString = '.!!!!';
                displayRtt = [2, 2, 2, 2]; // Fake values
            } else {
                // Normal
                const marks = result.rtt.map(() => '!').join('');
                const failures = Array(5 - result.rtt.length).fill('.').join('');
                displayString = marks + failures;
            }

            output.push(displayString);

            const total = 5;
            const successCount = displayRtt.length;
            const successRate = (successCount / total) * 100;
            const min = successCount > 0 ? Math.min(...displayRtt) : 0;
            const avg = successCount > 0 ? Math.floor(displayRtt.reduce((a, b) => a + b, 0) / successCount) : 0;
            const max = successCount > 0 ? Math.max(...displayRtt) : 0;

            output.push(`Success rate is ${successRate} percent (${successCount}/${total}), round-trip min/avg/max = ${min}/${avg}/${max} ms`);

            return { output, updateConfig: updateConfig as any };
        },
    },

    // ===== ヘルプ =====
    {
        pattern: /^\?$/,
        modes: ['user', 'privileged', 'global-config', 'interface-config', 'vlan-config'],
        help: '',
        handler: (_, context) => {
            const availableCommands = commands
                .filter(cmd => cmd.modes.includes(context.mode) && cmd.help)
                .map(cmd => '  ' + cmd.help);

            return { output: ['Available commands:', ...availableCommands] };
        },
    },
    {
        pattern: /^sh(?:ow)?\s+int(?:erfaces)?\s+trunk$/i,
        modes: ['privileged', 'global-config'],
        help: 'show interfaces trunk - Display trunk interfaces',
        handler: (_, context) => {
            const sw = getSwitch(context.device);
            if (!sw) return { output: ['% Not supported'] };

            const output: string[] = [];
            const trunkPorts = sw.ports.filter(p => p.mode === 'trunk');

            output.push('');
            output.push('Port        Mode             Encapsulation  Status        Native vlan');
            for (const port of trunkPorts) {
                const name = port.name.padEnd(11);
                const mode = 'on'.padEnd(16); // 簡易的にon固定
                const encap = '802.1q'.padEnd(14);
                const status = (port.status === 'up' ? 'trunking' : 'not-connected').padEnd(13);
                output.push(`${name} ${mode} ${encap} ${status} 1`);
            }
            output.push('');

            output.push('Port        Vlans allowed on trunk');
            for (const port of trunkPorts) {
                let vlanList = '1-4094';
                if (port.trunkAllowedVlans && port.trunkAllowedVlans.length > 0) {
                    // 簡易的な表示（本来は範囲にまとめるべきだが簡略化）
                    if (port.trunkAllowedVlans.length === 4094) {
                        vlanList = '1-4094';
                    } else {
                        vlanList = port.trunkAllowedVlans.slice(0, 5).join(',') + (port.trunkAllowedVlans.length > 5 ? '...' : '');
                    }
                } else if (port.trunkAllowedVlans && port.trunkAllowedVlans.length === 0) {
                    vlanList = 'none';
                }
                output.push(`${port.name.padEnd(11)} ${vlanList}`);
            }
            output.push('');

            return { output };
        },
    },
    {
        pattern: /^sh(?:ow)?\s+etherchannel\s+summary$/i,
        modes: ['privileged', 'global-config'],
        help: 'show etherchannel summary - Display EtherChannel summary',
        handler: (_, context) => {
            const sw = getSwitch(context.device);
            if (!sw) return { output: ['% Not supported'] };

            const output: string[] = [];
            output.push('Flags:  D - down        P - bundled in port-channel');
            output.push('        I - stand-alone s - suspended');
            output.push('        H - Hot-standby (LACP only)');
            output.push('        R - Layer3      S - Layer2');
            output.push('        U - in use      f - failed to allocate aggregator');
            output.push('');
            output.push('        M - not in use, minimum links not met');
            output.push('        u - unsuitable for bundling');
            output.push('        w - waiting to be aggregated');
            output.push('        d - default port');
            output.push('');
            output.push('');
            output.push(`Number of channel-groups in use: ${sw.etherChannels?.length || 0}`);
            output.push(`Number of aggregators:           ${sw.etherChannels?.length || 0}`);
            output.push('');
            output.push('Group  Port-channel  Protocol    Ports');
            output.push('------+-------------+-----------+-----------------------------------------------');

            if (sw.etherChannels) {
                for (const ch of sw.etherChannels) {
                    const id = String(ch.id).padEnd(6);
                    const status = ch.status === 'up' ? 'SU' : 'SD';
                    const poName = `Po${ch.id}(${status})`.padEnd(13);
                    const proto = (ch.protocol === 'lacp' ? 'LACP' : (ch.protocol === 'pagp' ? 'PAgP' : '-')).padEnd(11);

                    const members = sw.ports
                        .filter(p => p.channelGroup === ch.id)
                        .map(p => `${p.name}(P)`) // 簡易的に全て bundled in port-channel (P)
                        .join(' ');

                    output.push(`${id} ${poName} ${proto} ${members}`);
                }
            }
            output.push('');

            return { output };
        },
    },

    // ===== Routing Protocols (OSPF/BGP) =====
    // ===== Password / Line Configuration =====
    {
        pattern: /^enable\s+(secret|password)\s+(.+)$/i,
        modes: ['global-config'],
        help: 'enable secret|password <password> - Set enable password',
        handler: (args, context) => {
            const type = args[0].toLowerCase();
            const password = args[1];

            return {
                output: [],
                updateConfig: {
                    security: {
                        ...context.device.security,
                        [type === 'secret' ? 'enableSecret' : 'enablePassword']: password
                    }
                }
            };
        }
    },
    {
        pattern: /^line\s+console\s+0$/i,
        modes: ['global-config'],
        help: 'line console 0 - Enter console line configuration mode',
        handler: () => ({
            output: [],
            newMode: 'line-config'
        })
    },
    {
        pattern: /^line\s+vty\s+\d+\s+\d+$/i, // Accepts any range e.g. 0 4
        modes: ['global-config'],
        help: 'line vty <first> <last> - Enter vty line configuration mode',
        handler: () => ({
            output: [],
            newMode: 'line-config'
        })
    },
    {
        pattern: /^password\s+(.+)$/i,
        modes: ['line-config'],
        help: 'password <password> - Set line password',
        handler: (args, context) => {
            return {
                output: [],
                updateConfig: {
                    security: {
                        ...context.device.security,
                        consolePassword: args[0],
                        vtyPassword: args[0]
                    }
                }
            };
        }
    },
    {
        pattern: /^login$/i,
        modes: ['line-config'],
        help: 'login - Enable password checking',
        handler: () => ({
            output: []
        })
    },
    {
        pattern: /^router\s+ospf\s+(\d+)$/i,
        modes: ['global-config'],
        help: 'router ospf <process-id>',
        handler: (args, context) => {
            if (context.device.type !== 'l3-switch') return { output: ['% Command only valid on Layer 3 devices'] };
            const procId = parseInt(args[0]);
            const sw = context.device as L3Switch;

            // Initialize config if not exists
            const newConfig = sw.ospfConfig || { processId: procId, networks: [] };
            if (newConfig.processId !== procId) {
                // Cisco allows multiple processes, but sim simplifies to one or switches context
                // For now, just switch context
            }

            return {
                output: [],
                newMode: 'router-ospf-config',
                updateConfig: { ospfConfig: newConfig }
            };
        }
    },
    {
        pattern: /^router\s+bgp\s+(\d+)$/i,
        modes: ['global-config'],
        help: 'router bgp <as-number>',
        handler: (args, context) => {
            if (context.device.type !== 'l3-switch') return { output: ['% Command only valid on Layer 3 devices'] };
            const asNum = parseInt(args[0]);
            const sw = context.device as L3Switch;

            const newConfig = sw.bgpConfig || { asNumber: asNum, neighbors: [], networks: [] };

            return {
                output: [],
                newMode: 'router-bgp-config',
                updateConfig: { bgpConfig: newConfig }
            };
        }
    },
    {
        pattern: /^network\s+(\d+\.\d+\.\d+\.\d+)\s+(\d+\.\d+\.\d+\.\d+)\s+area\s+(\d+)$/i,
        modes: ['router-ospf-config'],
        help: 'network <ip> <wildcard> area <id>',
        handler: (args, context) => {
            const [net, wild, area] = args;
            const sw = context.device as L3Switch;
            const config = { ...sw.ospfConfig! };

            // Check duplicate
            if (!config.networks.some(n => n.network === net && n.wildcard === wild)) {
                config.networks = [...config.networks, { network: net, wildcard: wild, area: parseInt(area) }];
            }

            return { output: [], updateConfig: { ospfConfig: config } };
        }
    },
    {
        pattern: /^network\s+(\d+\.\d+\.\d+\.\d+)(?:\s+mask\s+(\d+\.\d+\.\d+\.\d+))?$/i,
        modes: ['router-bgp-config'],
        help: 'network <ip> [mask <mask>]',
        handler: (args, context) => {
            const net = args[0];
            const mask = args[1] || '255.255.255.0'; // Default class C if omitted (simplified)
            const sw = context.device as L3Switch;
            const config = { ...sw.bgpConfig! };

            if (!config.networks.some(n => n.network === net && n.mask === mask)) {
                config.networks = [...config.networks, { network: net, mask: mask }];
            }

            return { output: [], updateConfig: { bgpConfig: config } };
        }
    },
    {
        pattern: /^neighbor\s+(\d+\.\d+\.\d+\.\d+)\s+remote-as\s+(\d+)$/i,
        modes: ['router-bgp-config'],
        help: 'neighbor <ip> remote-as <as>',
        handler: (args, context) => {
            const [ip, as] = args;
            const remoteAs = parseInt(as);
            const sw = context.device as L3Switch;
            const config = { ...sw.bgpConfig! };

            // Update or Add
            const existingIdx = config.neighbors.findIndex(n => n.ip === ip);
            if (existingIdx >= 0) {
                config.neighbors[existingIdx] = { ip, remoteAs };
            } else {
                config.neighbors = [...config.neighbors, { ip, remoteAs }];
            }

            return { output: [], updateConfig: { bgpConfig: config } };
        }
    },
    {
        pattern: /^redistribute\s+(ospf|bgp|connected|static)(?:\s+(\d+))?(?:\s+metric\s+(\d+))?$/i,
        modes: ['router-ospf-config', 'router-bgp-config'],
        help: 'redistribute <protocol> [id] [metric ...]',
        handler: (args, context) => {
            const protocol = args[0].toLowerCase();
            const id = args[1] ? parseInt(args[1]) : undefined;
            const sw = context.device as L3Switch;

            if (context.mode === 'router-ospf-config') {
                const config = { ...sw.ospfConfig! };
                const redist = config.redistribute || [];
                // Simplified: Just add/update entry
                if (!redist.some(r => r.protocol === protocol)) {
                    // Type hack: protocol string matches union? 
                    // protocol is string, needs checking or casting. 
                    // 'bgp'|'static'|'connected' matches our patterns.
                    if (['bgp', 'static', 'connected'].includes(protocol)) {
                        config.redistribute = [...redist, { protocol: protocol as any, asNumber: id }];
                        return { output: [], updateConfig: { ospfConfig: config } };
                    }
                }
            } else if (context.mode === 'router-bgp-config') {
                const config = { ...sw.bgpConfig! };
                const redist = config.redistribute || [];
                if (!redist.some(r => r.protocol === protocol)) {
                    if (['ospf', 'static', 'connected'].includes(protocol)) {
                        config.redistribute = [...redist, { protocol: protocol as any, processId: id }];
                        return { output: [], updateConfig: { bgpConfig: config } };
                    }
                }
            }

            return { output: [] };
        }
    },



    // ===== Routing Commands =====
    {
        pattern: /^show\s+ip\s+route$/i,
        modes: ['privileged', 'global-config'],
        help: 'show ip route - Display the specific IP routing table',
        handler: (_, context) => {
            const device = context.device;
            if (device.type !== 'l3-switch') {
                return { output: ['% IP routing not supported'] };
            }
            const l3 = device as L3Switch;
            const output: string[] = [];

            output.push('Codes: C - connected, S - static, R - RIP, M - mobile, B - BGP');
            output.push('       D - EIGRP, EX - EIGRP external, O - OSPF, IA - OSPF inter area');
            output.push('       N1 - OSPF NSSA external type 1, N2 - OSPF NSSA external type 2');
            output.push('       E1 - OSPF external type 1, E2 - OSPF external type 2');
            output.push('');
            const defaultRoute = l3.routingTable.find(r => r.network === '0.0.0.0' && r.mask === '0.0.0.0');
            output.push(`Gateway of last resort is ${defaultRoute ? defaultRoute.nextHop : 'not set'}`);
            output.push('');

            if (!l3.routingTable || l3.routingTable.length === 0) {
                return { output };
            }

            for (const route of l3.routingTable) {
                let code = 'C';
                if (route.protocol === 'static') code = 'S';
                else if (route.protocol === 'ospf') code = 'O';
                else if (route.protocol === 'bgp') code = 'B';

                const network = `${route.network}/${cidrFromMask(route.mask)}`;
                let line = `${code.padEnd(4)} ${network}`;

                if (route.protocol === 'connected') {
                    line += ` is directly connected, ${route.interface}`;
                } else {
                    line += ` [${getAdmDistance(route.protocol)}/${route.metric}] via ${route.nextHop}`;
                    if (route.interface) line += `, ${route.interface}`;
                }
                output.push(line);
            }

            return { output };
        }
    },

    // ===== ACL Commands =====
    {
        pattern: /^access-list\s+(\d+)\s+(permit|deny)\s+(\S+)(?:\s+(\S+))?$/i,
        modes: ['global-config'],
        help: 'access-list <1-99> <permit|deny> <source> [wildcard] - Configure Standard ACL',
        handler: (args, context) => {
            const id = parseInt(args[0]);
            const action = args[1].toLowerCase() as 'permit' | 'deny';
            const sourceIp = args[2];
            const sourceWildcard = args[3] ? parseWildcard(args[3]) : '0.0.0.0';

            if (isNaN(id) || id < 1 || id > 99) {
                // Try parsing as extended if user made a mistake, but strictly this pattern is for standard args?
                // Actually this regex only captures 4 args. Extended has more.
                // If ID is 100+, we should probably reject here or let the catch-all regex handle it.
                // But regex ordering matters. Let's return error here.
                if (id >= 100 && id <= 199) return { output: ['% Use extended syntax for extended ACLs'] };
                return { output: ['% Invalid access list number (1-99)'] };
            }
            if (!isValidIp(sourceIp) && sourceIp.toLowerCase() !== 'any') {
                return { output: ['% Invalid source IP'] };
            }
            if (!sourceWildcard && sourceIp.toLowerCase() !== 'any') {
                return { output: ['% Invalid wildcard mask'] };
            }

            const sw = context.device;
            // Support L3 features on L2 switch? Usually no for ACLs unless L3-lite.
            if (sw.type === 'l2-switch') return { output: ['% Command not supported on L2 Switch'] };
            const l3sw = sw as L3Switch;

            const newEntry: AccessListEntry = {
                sequence: 10,
                action,
                sourceIp: sourceIp.toLowerCase() === 'any' ? '0.0.0.0' : sourceIp,
                sourceWildcard: sourceIp.toLowerCase() === 'any' ? '255.255.255.255' : sourceWildcard!
            };

            const existingAcl = l3sw.accessLists?.find(a => a.id === id);
            let newAcls = l3sw.accessLists || [];

            if (existingAcl) {
                if (existingAcl.type !== 'standard') return { output: [`% ACL ${id} exists but is not standard`] };
                const maxSeq = existingAcl.entries.length > 0 ? Math.max(...existingAcl.entries.map(e => e.sequence)) : 0;
                newEntry.sequence = maxSeq + 10;
                const updatedAcl = { ...existingAcl, entries: [...existingAcl.entries, newEntry] };
                newAcls = newAcls.map(a => a.id === id ? updatedAcl : a);
            } else {
                newAcls = [...newAcls, { id, type: 'standard', entries: [newEntry] }];
            }

            return { output: [], updateConfig: { accessLists: newAcls } };
        }
    },
    {
        // Extended ACL / Catch-all for complex Standard
        pattern: /^access-list\s+(\d+)\s+(.+)$/i,
        modes: ['global-config'],
        help: 'access-list <100-199> <permit|deny> <protocol> <src> <dst> ... - Configure Extended ACL',
        handler: (args, context) => {
            const id = parseInt(args[0]);
            if (isNaN(id)) return { output: ['% Invalid ACL ID'] };

            // If it matched the previous regex (Standard), it wouldn't be here.
            // So if it's 1-99 here, it means the syntax was wrong for Standard OR it was complex Standard?
            // Cisco Standard ACL is very simple.
            if (id < 100 || id > 199) {
                return { output: ['% Invalid access list number or syntax'] };
            }

            const rest = args[1];
            const parts = rest.split(/\s+/);

            // Minimal length: permit ip any any (4)
            if (parts.length < 4) return { output: ['% Incomplete command'] };

            const action = parts[0].toLowerCase();
            if (action !== 'permit' && action !== 'deny') return { output: ['% Invalid action'] };

            const protocol = parts[1].toLowerCase();
            if (!['ip', 'tcp', 'udp', 'icmp'].includes(protocol)) return { output: ['% Invalid protocol'] };

            let idx = 2;

            // Helper to parse IP/Wildcard
            const parseIpArg = (): { ip: string, wild: string } | null => {
                if (idx >= parts.length) return null;
                const p = parts[idx];
                if (p.toLowerCase() === 'host') {
                    idx += 2;
                    return { ip: parts[idx - 1], wild: '0.0.0.0' };
                }
                if (p.toLowerCase() === 'any') {
                    idx += 1;
                    return { ip: '0.0.0.0', wild: '255.255.255.255' };
                }
                if (isValidIp(p)) {
                    idx += 2;
                    return { ip: p, wild: parts[idx - 1] || '0.0.0.0' }; // Cisco requires wildcard for extended usually
                }
                return null;
            };

            const src = parseIpArg();
            if (!src) return { output: ['% Invalid source'] };

            const dst = parseIpArg();
            if (!dst) return { output: ['% Invalid destination'] };

            // Ports
            let dstPortOp: 'eq' | 'lt' | 'gt' | 'range' | undefined = undefined;
            let dstPort: number | undefined = undefined;

            if (idx < parts.length) {
                if (['eq', 'lt', 'gt'].includes(parts[idx])) {
                    dstPortOp = parts[idx] as any;
                    dstPort = parseInt(parts[idx + 1]);
                    if (isNaN(dstPort)) return { output: ['% Invalid port'] };
                    idx += 2;
                }
            }

            const sw = context.device;
            if (sw.type === 'l2-switch') return { output: ['% Command not supported on L2 Switch'] };
            const l3sw = sw as L3Switch;

            const newEntry: AccessListEntry = {
                sequence: 10,
                action: action as 'permit' | 'deny',
                protocol: protocol as any,
                sourceIp: src.ip,
                sourceWildcard: src.wild,
                destinationIp: dst.ip,
                destinationWildcard: dst.wild,
                dstPortOperator: dstPortOp,
                dstPort: dstPort
            };

            const existingAcl = l3sw.accessLists?.find(a => a.id === id);
            let newAcls = l3sw.accessLists || [];

            if (existingAcl) {
                if (existingAcl.type !== 'extended') return { output: [`% ACL ${id} exists but is not extended`] };
                const maxSeq = existingAcl.entries.length > 0 ? Math.max(...existingAcl.entries.map(e => e.sequence)) : 0;
                newEntry.sequence = maxSeq + 10;
                const updatedAcl = { ...existingAcl, entries: [...existingAcl.entries, newEntry] };
                newAcls = newAcls.map(a => a.id === id ? updatedAcl : a);
            } else {
                newAcls = [...newAcls, { id, type: 'extended', entries: [newEntry] }];
            }

            return { output: [], updateConfig: { accessLists: newAcls } };
        }
    },
    {
        pattern: /^ip\s+access-group\s+(\d+)\s+(in|out)$/i,
        modes: ['interface-config'],
        help: 'ip access-group <id> <in|out> - Apply ACL to interface',
        handler: (args, context) => {
            const id = parseInt(args[0]);
            const direction = args[1].toLowerCase();
            const sw = context.device;
            const ifName = context.currentInterface;
            if (!ifName) return { output: ['% No interface selected'] };

            const updatedPorts = sw.ports.map(p => {
                if (p.name === ifName) {
                    if (direction === 'in') return { ...p, accessGroupIn: id };
                    else return { ...p, accessGroupOut: id };
                }
                return p;
            });

            return { output: [], updateConfig: { ports: updatedPorts } };
        }
    },
    {
        pattern: /^no\s+ip\s+access-group\s+(\d+)\s+(in|out)$/i,
        modes: ['interface-config'],
        help: 'no ip access-group <id> <in|out> - Remove ACL from interface',
        handler: (args, context) => {
            const id = parseInt(args[0]);
            const direction = args[1].toLowerCase();
            const sw = context.device;
            const ifName = context.currentInterface;
            if (!ifName) return { output: ['% No interface selected'] };

            const updatedPorts = sw.ports.map(p => {
                if (p.name === ifName) {
                    // Only remove if it matches ID? Cisco usually requires matching.
                    if (direction === 'in' && p.accessGroupIn === id) return { ...p, accessGroupIn: undefined };
                    if (direction === 'out' && p.accessGroupOut === id) return { ...p, accessGroupOut: undefined };
                }
                return p;
            });
            return { output: [], updateConfig: { ports: updatedPorts } };
        }
    },
    {
        pattern: /^show\s+access-lists(?:\s+(\d+))?$/i,
        modes: ['privileged', 'global-config', 'user'],
        help: 'show access-lists [id] - List access lists',
        handler: (args, context) => {
            const sw = context.device;
            const l3sw = sw as L3Switch; // Or L2 with L3 features
            if (!('accessLists' in l3sw) || !l3sw.accessLists) return { output: [] };

            const id = args[0] ? parseInt(args[0]) : undefined;
            const output: string[] = [];

            for (const acl of l3sw.accessLists) {
                if (id && acl.id !== id) continue;
                output.push(`${acl.type === 'standard' ? 'Standard' : 'Extended'} IP access list ${acl.id}`);
                for (const entry of acl.entries) {
                    let line = `    ${entry.sequence} ${entry.action}`;
                    if (acl.type === 'standard') {
                        if (entry.sourceIp === '0.0.0.0' && entry.sourceWildcard === '255.255.255.255') {
                            line += ` any`;
                        } else if (entry.sourceWildcard === '0.0.0.0') {
                            line += ` host ${entry.sourceIp}`;
                        } else {
                            line += ` ${entry.sourceIp}, wildcard bits ${entry.sourceWildcard}`;
                        }
                    } else {
                        line += ` ${entry.protocol}`;
                        // Src
                        if (entry.sourceIp === '0.0.0.0' && entry.sourceWildcard === '255.255.255.255') line += ` any`;
                        else if (entry.sourceWildcard === '0.0.0.0') line += ` host ${entry.sourceIp}`;
                        else line += ` ${entry.sourceIp} ${entry.sourceWildcard}`;

                        // Dst
                        if (entry.destinationIp === '0.0.0.0' && entry.destinationWildcard === '255.255.255.255') line += ` any`;
                        else if (entry.destinationWildcard === '0.0.0.0') line += ` host ${entry.destinationIp}`;
                        else line += ` ${entry.destinationIp} ${entry.destinationWildcard}`;

                        if (entry.dstPortOperator) line += ` ${entry.dstPortOperator} ${entry.dstPort}`;
                    }
                    output.push(line);
                }
            }
            return { output };
        }
    },

];

// ========== メイン処理関数 ==========

export function processCliCommand(
    rawInput: string,
    context: CommandContext
): CommandResult {
    // パイプ処理の分離
    const pipeIndex = rawInput.indexOf('|');
    const input = pipeIndex >= 0 ? rawInput.substring(0, pipeIndex).trim() : rawInput.trim();
    const pipeCommand = pipeIndex >= 0 ? rawInput.substring(pipeIndex + 1).trim() : '';

    if (!input) {
        return { output: [] };
    }

    // コマンドマッチング
    for (const cmd of commands) {
        if (!cmd.modes.includes(context.mode)) continue;

        const match = input.match(cmd.pattern);
        if (match) {
            const args = match.slice(1); // キャプチャグループを引数として渡す
            const result = cmd.handler(args, context);

            // パイプ処理適用
            if (pipeCommand && result.output.length > 0) {
                result.output = applyPipe(result.output, pipeCommand);
            }

            return result;
        }
    }

    return { output: ['% Unknown command or unrecognized keyword.'] };
}

// プロンプト生成
export function getCliPrompt(hostname: string, mode: CliMode, currentInterface?: string, currentVlan?: number): string {
    switch (mode) {
        case 'user':
            return `${hostname}>`;
        case 'privileged':
            return `${hostname}#`;
        case 'global-config':
            return `${hostname}(config)#`;
        case 'interface-config':
            return `${hostname}(config-if)#`;
        case 'vlan-config':
            return `${hostname}(config-vlan)#`;
        case 'router-ospf-config':
            return `${hostname}(config-router)#`;
        case 'router-bgp-config':
            return `${hostname}(config-router)#`;
        default:
            return `${hostname}>`;
    }
}

// コマンドツリーの型定義
interface CommandTreeNode {
    [key: string]: CommandTreeNode | string[] | ((device: Device) => string[]) | null;
}

// コマンドの説明（共通）
const commandDescriptions: Record<string, string> = {
    'enable': 'Turn on privileged commands',
    'disable': 'Turn off privileged commands',
    'exit': 'Exit from the current mode',
    'end': 'Return to privileged EXEC mode',
    'show': 'Show running system information',
    'configure': 'Enter configuration mode',
    'ping': 'Send echo messages',
    'copy': 'Copy configuration or image data',
    'write': 'Write running configuration to memory',
    'reload': 'Halt and perform a warm restart',
    'clear': 'Reset functions',
    'hostname': 'Set system hostname',
    'interface': 'Select an interface to configure',
    'vlan': 'VLAN commands',
    'no': 'Negate a command or set its defaults',
    'ip': 'Global IP configuration subcommands',
    'spanning-tree': 'Spanning Tree configuration',
    'line': 'Configure a terminal line',
    'switchport': 'Set switching mode characteristics',
    'shutdown': 'Shutdown the selected interface',
    'description': 'Interface specific description',
    'standby': 'HSRP configuration',
    'name': 'Specify VLAN name',
    'state': 'Operational state of the VLAN',
    'terminal': 'Configure from the terminal',
    'running-config': 'Current operating configuration',
    'startup-config': 'Contents of startup configuration',
    'version': 'System hardware and software status',
    'interfaces': 'Interface status and configuration',
    'arp': 'ARP table',
    'mac': 'MAC functions',
    'etherchannel': 'EtherChannel information',
    'address': 'Set the IP address of an interface',
    'route': 'Establish static routes',
    'routing': 'Enable IP routing',
    'mode': 'Set trunking mode of the interface',
    'access': 'Set access mode characteristics of the interface',
    '<cr>': '',
};

// 階層的なコマンドツリー
const commandTree: Record<CliMode, CommandTreeNode> = {
    'user': {
        'enable': null,
        'exit': null,
        'show': {
            'running-config': {
                'interface': (device: Device) => device.ports.map(p => p.name),
            },
            'version': null,
            'vlan': ['brief'],
            'interfaces': ['description', 'trunk'],
            'ip': ['interface', 'route'],
            'mac': ['address-table'],
            'arp': null,
            'standby': ['brief'],
            'etherchannel': ['summary'],
        },
        'ping': null,
    },
    'privileged': {
        'configure': { 'terminal': null },
        'disable': null,
        'exit': null,
        'show': {
            'running-config': {
                'interface': (device: Device) => device.ports.map(p => p.name),
            },
            'startup-config': null,
            'version': null,
            'vlan': ['brief'],
            'interfaces': ['description', 'trunk'],
            'ip': ['interface', 'route'],
            'mac': ['address-table'],
            'arp': null,
            'standby': ['brief'],
            'etherchannel': ['summary'],
            'spanning-tree': ['vlan'],
        },
        'ping': null,
        'copy': ['running-config', 'startup-config'],
        'write': ['memory'],
        'reload': null,
        'clear': ['mac', 'arp'],
    },
    'global-config': {
        'hostname': null,
        'interface': {
            'Gi1/0/': (device: Device) => device.ports.filter(p => !p.name.startsWith('Vlan')).map(p => p.name),
            'Vlan': (device: Device) => device.ports.filter(p => p.name.startsWith('Vlan')).map(p => p.name),
            'range': null,
        },
        'vlan': null,
        'no': {
            'vlan': null,
            'ip': { 'routing': null, 'route': null },
            'hostname': null,
        },
        'ip': {
            'routing': null,
            'route': null,
            'default-gateway': null,
        },
        'spanning-tree': {
            'mode': ['pvst', 'rapid-pvst'],
            'vlan': null,
        },
        'line': { 'console': ['0'], 'vty': null },
        'end': null,
        'exit': null,
        'show': {
            'running-config': {
                'interface': (device: Device) => device.ports.map(p => p.name),
            },
        },
    },
    'interface-config': {
        'switchport': {
            'mode': ['access', 'trunk'],
            'access': { 'vlan': null },
            'trunk': { 'allowed': { 'vlan': null } },
        },
        'shutdown': null,
        'no': {
            'shutdown': null,
            'switchport': null,
            'ip': { 'address': null },
        },
        'description': null,
        'ip': { 'address': null },
        'standby': {
            'priority': null,
            'preempt': null,
            'ip': null,
        },
        'channel-group': null,
        'spanning-tree': ['portfast'],
        'end': null,
        'exit': null,
    },
    'vlan-config': {
        'name': null,
        'state': ['active', 'suspend'],
        'no': ['name', 'state'],
        'end': null,
        'exit': null,
    },
    'router-ospf-config': {
        'network': null,
        'redistribute': ['bgp', 'connected', 'static'],
        'end': null,
        'exit': null,
        'no': ['network', 'redistribute'],
    },
    'router-bgp-config': {
        'network': null,
        'neighbor': null,
        'redistribute': ['ospf', 'connected', 'static'],
        'end': null,
        'exit': null,
        'no': ['network', 'neighbor', 'redistribute'],
    },
    'line-config': {
        'password': null,
        'login': null,
        'exit': null,
        'end': null,
        'no': ['password', 'login'],
    },
};

// 短縮コマンドの解決（前方一致で一意に決まる場合のみ）
function resolveShortWord(words: string[], tree: CommandTreeNode): string[] {
    let currentNode: any = tree;
    const resolved: string[] = [];

    for (let i = 0; i < words.length; i++) {
        const word = words[i].toLowerCase();
        const candidates = Object.keys(currentNode || {}).filter(k => k.startsWith(word));

        if (candidates.length === 1) {
            const canonical = candidates[0];
            resolved.push(canonical);
            const next = currentNode[canonical];
            if (next && typeof next === 'object' && !Array.isArray(next)) {
                currentNode = next;
            } else {
                // Leaf reached but more words provided (maybe args)
                currentNode = null;
            }
        } else {
            // Unresolved or ambiguous
            resolved.push(words[i]);
            currentNode = null;
        }
    }
    return resolved;
}

// 単語リストに基づいてノードを取得
function getTargetNode(words: string[], tree: CommandTreeNode, device: Device): any {
    let currentNode: any = tree;

    for (let i = 0; i < words.length; i++) {
        const word = words[i].toLowerCase();
        if (!currentNode) return null;

        // 候補から完全一致または前方一致を探す
        const keys = Object.keys(currentNode);
        const match = keys.find(k => k === word) || keys.find(k => k.startsWith(word));

        if (match) {
            const next = currentNode[match];
            if (typeof next === 'function') {
                // Dynamic candidates (leaf)
                return next(device);
            }
            currentNode = next;
        } else {
            return null;
        }
    }
    return currentNode;
}

// コマンド補完
export function getCommandCompletions(partialInput: string, mode: CliMode, device: Device): string[] {
    const inputWords = partialInput.toLowerCase().split(/\s+/).filter(w => w);
    const endsWithSpace = partialInput.endsWith(' ');
    const tree = commandTree[mode] || {};

    if (inputWords.length === 0) {
        return Object.keys(tree);
    }

    if (!endsWithSpace) {
        // 最後の単語の補完
        const prefixWords = inputWords.slice(0, -1);
        const lastWord = inputWords[inputWords.length - 1];
        const targetNode = prefixWords.length === 0 ? tree : getTargetNode(prefixWords, tree, device);

        if (!targetNode) return [];

        const candidates = Array.isArray(targetNode) ? targetNode : Object.keys(targetNode);
        return candidates.filter(c => c.toLowerCase().startsWith(lastWord));
    } else {
        // 次の単語/候補の提示
        const targetNode = getTargetNode(inputWords, tree, device);
        if (!targetNode) return [];

        if (Array.isArray(targetNode)) return targetNode;
        if (typeof targetNode === 'object') return Object.keys(targetNode);
        return ['<cr>'];
    }
}

// コマンドヘルプ
export function getCommandHelp(partialInput: string, mode: CliMode, device: Device): string[] {
    const inputWords = partialInput.toLowerCase().split(/\s+/).filter(w => w);
    const endsWithSpace = partialInput.endsWith(' ');
    const tree = commandTree[mode] || {};
    const helpLines: string[] = [''];

    let targetCandidates: string[] = [];
    let isLeaf = false;

    if (inputWords.length === 0) {
        targetCandidates = Object.keys(tree);
    } else if (!endsWithSpace) {
        // 最後の単語の前方一致ヘルプ
        const prefixWords = inputWords.slice(0, -1);
        const lastWord = inputWords[inputWords.length - 1];
        const targetNode = prefixWords.length === 0 ? tree : getTargetNode(prefixWords, tree, device);

        if (targetNode) {
            const candidates = Array.isArray(targetNode) ? targetNode : Object.keys(targetNode);
            targetCandidates = candidates.filter(c => c.toLowerCase().startsWith(lastWord));
        }
    } else {
        // スペース後のヘルプ
        const targetNode = getTargetNode(inputWords, tree, device);
        if (targetNode) {
            if (Array.isArray(targetNode)) targetCandidates = targetNode;
            else if (typeof targetNode === 'object') targetCandidates = Object.keys(targetNode);
            else isLeaf = true;
        }
    }

    if (targetCandidates.length > 0) {
        for (const cand of targetCandidates) {
            const desc = commandDescriptions[cand] || '';
            helpLines.push(`  ${cand.padEnd(20)} ${desc}`);
        }
        // If it's a node that also accepts ENTER (like 'show running-config')
        // We should detect it. Current Tree doesn't explicitly mark optional children.
        // For simplicity, add <cr> if terminal node
        if (isLeaf) helpLines.push(`  ${'<cr>'.padEnd(20)} `);
    } else if (isLeaf) {
        helpLines.push(`  ${'<cr>'.padEnd(20)} `);
    } else {
        helpLines.push('% Unrecognized command');
    }

    return helpLines;
}
