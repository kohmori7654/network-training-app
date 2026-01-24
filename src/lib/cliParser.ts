/**
 * Cisco IOS風 CLIパーサー
 * モード遷移、コマンド登録、パイプ処理をサポート
 */

import { Device, L2Switch, L3Switch, CliMode, Port, VlanInfo, Connection, EtherChannel } from '@/stores/types';
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
    const normalizedName = portName.toLowerCase()
        .replace(/^gi/, 'Gi')
        .replace(/^fa/, 'Fa')
        .replace(/^eth/, 'eth')
        .replace(/^po(?:rt-channel)?(\d+)/, 'Po$1'); // Po1, Port-channel1 -> Po1

    return device.ports.find(p =>
        p.name.toLowerCase() === portName.toLowerCase() ||
        p.name.toLowerCase() === normalizedName.toLowerCase()
    );
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

            const updatedPorts = sw.ports.map(p =>
                targetPortIds.includes(p.id) ? { ...p, status: 'up' as const } : p
            );

            return { output: [], updateConfig: { ports: updatedPorts } };
        },
    },
    {
        pattern: /^switchport\s+mode\s+(access|trunk)$/i,
        modes: ['interface-config'],
        help: 'switchport mode access|trunk - Set interface mode',
        handler: (args, context) => {
            const mode = args[0].toLowerCase() as 'access' | 'trunk';
            const targetPortIds = context.selectedPortIds || (context.currentInterface ? [findPort(context.device, context.currentInterface)?.id].filter(id => id) as string[] : []);
            if (targetPortIds.length === 0) return { output: ['% No interface selected'] };

            const sw = getSwitch(context.device);
            if (!sw) return { output: ['% Invalid device'] };

            const updatedPorts = sw.ports.map(p =>
                targetPortIds.includes(p.id) ? { ...p, mode } : p
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
                const config = sw.stpState.vlanConfig?.[vid];
                const pri = config?.priority ?? sw.stpState.priority; // Fallback to global
                const rootType = config?.rootType ? `(${config.rootType})` : '';

                output.push(`VLAN${String(vid).padStart(4, '0')}`);
                output.push(`  Spanning tree enabled protocol ieee`);
                output.push(`  Root ID    Priority    ${pri}`);
                output.push(`             Address     ${sw.macAddress} (This bridge) ${rootType}`);
                output.push(`             Hello Time   2 sec  Max Age 20 sec  Forward Delay 15 sec`);
                output.push('');
                output.push(`  Bridge ID  Priority    ${pri} (priority ${pri} sys-id-ext ${vid})`);
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

                for (const p of ports) {
                    output.push(`${p.name.padEnd(19)} Desg FWD 4         128.1    P2p`);
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
        pattern: /^sh(?:ow)?\s+ru(?:n(?:ning-config)?)?$/i,
        modes: ['privileged', 'global-config', 'interface-config', 'vlan-config'],
        help: 'show running-config - Display current configuration',
        handler: (_, context) => {
            const sw = getSwitch(context.device);
            if (!sw) return { output: ['% Not supported'] };

            const isL3 = context.device.type === 'l3-switch';
            const timestamp = new Date().toLocaleString('en-US', {
                weekday: 'short', month: 'short', day: 'numeric',
                hour: '2-digit', minute: '2-digit', second: '2-digit', year: 'numeric'
            });

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
                config.push('ip cef');
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
            // Sort ports: SVIs last, or by name.
            // Helper to sort: Gi < Te < Po < Vlan
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

                if (port.status === 'admin-down') {
                    config.push(' shutdown');
                }

                const isSvi = port.name.toLowerCase().startsWith('vlan');

                if (isSvi) {
                    if (port.ipAddress) {
                        config.push(` ip address ${port.ipAddress} ${port.subnetMask}`);
                    } else if (!isL3 && (sw as L2Switch).ipDefaultGateway && port.name === 'Vlan1') {
                        // On L2, if Vlan1 has no specific IP but potentially could. 
                        // Usually L2 SVI IP is set on Vlan1.
                        config.push(' no ip address');
                    } else {
                        config.push(' no ip address');
                    }

                    // HSRP for L3
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
                    // Physical / EtherChannel
                    if (port.mode === 'routed') {
                        config.push(' no switchport');
                        if (port.ipAddress) {
                            config.push(` ip address ${port.ipAddress} ${port.subnetMask}`);
                        }
                    } else if (port.mode === 'trunk') {
                        config.push(' switchport trunk encapsulation dot1q');
                        config.push(' switchport mode trunk');
                        if (port.trunkAllowedVlans && port.trunkAllowedVlans.length > 0) {
                            config.push(` switchport trunk allowed vlan ${port.trunkAllowedVlans.join(',')}`);
                        }
                    } else if (port.mode === 'access') {
                        config.push(' switchport mode access');
                        if (port.vlan && port.vlan !== 1) {
                            config.push(` switchport access vlan ${port.vlan}`);
                        }
                    }
                    // Channel Group
                    if (port.channelGroup) {
                        config.push(` channel-group ${port.channelGroup} mode active`);
                    }
                    // Portfast (simulated default for all access ports in this sim?)
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
                    // Static routes
                    const staticRoutes = l3.routingTable.filter(r => r.protocol === 'static');
                    if (staticRoutes.length > 0) {
                        for (const route of staticRoutes) {
                            config.push(`ip route ${route.network} ${route.mask} ${route.nextHop}`);
                        }
                        config.push('!');
                    }
                }

                // OSPF / BGP Config stubs (if they existed in types, we'd add them here)
                if (l3.ospfConfig) {
                    config.push(`router ospf ${l3.ospfConfig.processId}`);
                    // router-id is not currently in type definition
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
            const result = checkConnectivity(
                context.allDevices,
                context.allConnections,
                context.device.id,
                targetIp
            );

            const output = ['Type escape sequence to abort.', `Sending 5, 100-byte ICMP Echos to ${targetIp}, timeout is 2 seconds:`];

            // Cisco風の出力 (! = 成功, . = 失敗)
            const marks = result.rtt.map(() => '!').join('');
            const failures = Array(5 - result.rtt.length).fill('.').join('');
            output.push(marks + failures);

            const successRate = (result.rtt.length / 5) * 100;
            const min = result.rtt.length > 0 ? Math.min(...result.rtt) : 0;
            const avg = result.rtt.length > 0 ? Math.floor(result.rtt.reduce((a, b) => a + b, 0) / result.rtt.length) : 0;
            const max = result.rtt.length > 0 ? Math.max(...result.rtt) : 0;

            output.push(`Success rate is ${successRate} percent (${result.rtt.length}/5), round-trip min/avg/max = ${min}/${avg}/${max} ms`);

            return { output };
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

// コマンド補完用：現在のモードで利用可能なコマンドのプレフィックスを取得
export function getCommandCompletions(partialInput: string, mode: CliMode): string[] {
    const normalizedInput = partialInput.toLowerCase().trim();

    // コマンド階層構造
    const commandTree: { [key in CliMode]: { [key: string]: string[] | null } } = {
        'user': {
            'enable': null,
            'exit': null,
            'show': ['running-config', 'version', 'vlan', 'interfaces', 'ip', 'mac', 'arp', 'standby', 'etherchannel'],
            'ping': null,
        },
        'privileged': {
            'configure': ['terminal'],
            'disable': null,
            'exit': null,
            'show': ['running-config', 'startup-config', 'version', 'vlan', 'interfaces', 'ip', 'mac', 'arp', 'standby', 'etherchannel'],
            'ping': null,
            'copy': ['running-config', 'startup-config'],
            'write': ['memory'],
            'reload': null,
            'clear': ['mac', 'arp'],
        },
        'global-config': {
            'hostname': null,
            'interface': ['Gi1/0/1', 'Gi1/0/2', 'Gi1/0/3', 'Vlan1', 'Vlan10'],
            'vlan': null,
            'no': ['vlan', 'ip', 'hostname'],
            'end': null,
            'exit': null,
            'ip': ['routing', 'route'],
            'spanning-tree': ['mode', 'vlan'],
            'show': ['running-config', 'version', 'vlan', 'interfaces', 'ip', 'mac', 'standby', 'spanning-tree'],
        },
        'interface-config': {
            'switchport': ['mode', 'access'],
            'shutdown': null,
            'no': ['shutdown', 'switchport', 'ip'],
            'description': null,
            'ip': ['address'],
            'standby': null,
            'end': null,
            'exit': null,
            'show': ['running-config', 'interfaces'],
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

    const tree = commandTree[mode] || {};
    const inputWords = normalizedInput.split(/\s+/).filter(w => w);

    // 入力が空の場合はトップレベルコマンド一覧
    if (inputWords.length === 0) {
        return Object.keys(tree);
    }

    // 最後のスペースで終わるかどうか
    const endsWithSpace = partialInput.endsWith(' ');

    // 短縮コマンドを正規コマンドに変換する関数
    const resolveShortCommand = (short: string): string | null => {
        const matches = Object.keys(tree).filter(cmd => cmd.startsWith(short));
        if (matches.length === 1) {
            return matches[0];
        }
        return null;
    };

    if (inputWords.length === 1 && !endsWithSpace) {
        // 1単語で補完中 → 前方一致
        const partial = inputWords[0];
        return Object.keys(tree).filter(cmd => cmd.startsWith(partial));
    }

    // 複数単語またはスペース終わり
    let firstWord = inputWords[0];

    // 短縮コマンドを解決
    const resolved = resolveShortCommand(firstWord);
    if (resolved) {
        firstWord = resolved;
    }

    const subCommands = tree[firstWord];

    if (!subCommands) {
        // サブコマンドがないコマンド
        if (endsWithSpace && (Object.keys(tree).includes(firstWord) || resolved)) {
            return ['<cr>'];
        }
        return [];
    }

    if (inputWords.length === 1 && endsWithSpace) {
        // 'show ' や 'sh ' のようにスペースで終わっている場合
        return subCommands;
    }

    if (inputWords.length === 2 && !endsWithSpace) {
        // 'show ver' や 'sh ver' のような途中入力
        const partial = inputWords[1];
        return subCommands.filter(sub => sub.toLowerCase().startsWith(partial));
    }

    if (inputWords.length === 2 && endsWithSpace) {
        // 'show version ' のようにスペースで終わっている
        return ['<cr>'];
    }

    return [];
}

// コマンドヘルプ（?を押したとき用）- Cisco IOS形式
export function getCommandHelp(partialInput: string, mode: CliMode): string[] {
    const normalizedInput = partialInput.toLowerCase().trim();
    const helpLines: string[] = [''];

    // コマンドの説明
    const commandDescriptions: { [key: string]: string } = {
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
        '<cr>': '',
    };

    // コマンドのオプション（引数）情報
    const commandOptions: { [key: string]: { option: string; desc: string }[] } = {
        'enable': [
            { option: '<cr>', desc: '' },
        ],
        'disable': [
            { option: '<cr>', desc: '' },
        ],
        'exit': [
            { option: '<cr>', desc: '' },
        ],
        'end': [
            { option: '<cr>', desc: '' },
        ],
        'show': [
            { option: 'arp', desc: 'ARP table' },
            { option: 'etherchannel', desc: 'EtherChannel information' },
            { option: 'interfaces', desc: 'Interface status and configuration' },
            { option: 'ip', desc: 'IP information' },
            { option: 'mac', desc: 'MAC functions' },
            { option: 'running-config', desc: 'Current operating configuration' },
            { option: 'standby', desc: 'HSRP information' },
            { option: 'startup-config', desc: 'Contents of startup configuration' },
            { option: 'version', desc: 'System hardware and software status' },
            { option: 'vlan', desc: 'VTP VLAN status' },
        ],
        'configure': [
            { option: 'terminal', desc: 'Configure from the terminal' },
        ],
        'ping': [
            { option: 'WORD', desc: 'Ping destination address or hostname' },
        ],
        'hostname': [
            { option: 'WORD', desc: 'This system\'s network name' },
        ],
        'interface': [
            { option: 'GigabitEthernet', desc: 'GigabitEthernet IEEE 802.3z' },
            { option: 'Vlan', desc: 'Catalyst Vlans' },
        ],
        'vlan': [
            { option: '<1-4094>', desc: 'VLAN ID' },
        ],
        'ip': [
            { option: 'address', desc: 'Set the IP address of an interface' },
            { option: 'route', desc: 'Establish static routes' },
            { option: 'routing', desc: 'Enable IP routing' },
        ],
        'switchport': [
            { option: 'access', desc: 'Set access mode characteristics of the interface' },
            { option: 'mode', desc: 'Set trunking mode of the interface' },
        ],
        'shutdown': [
            { option: '<cr>', desc: '' },
        ],
        'no': [
            { option: 'hostname', desc: 'Reset system hostname' },
            { option: 'ip', desc: 'Negate IP commands' },
            { option: 'shutdown', desc: 'Enable interface' },
            { option: 'switchport', desc: 'Negate switchport commands' },
            { option: 'vlan', desc: 'Delete VLAN' },
        ],
        'standby': [
            { option: '<0-255>', desc: 'group number' },
        ],
        'name': [
            { option: 'WORD', desc: 'The ascii name for the VLAN' },
        ],
        'copy': [
            { option: 'running-config', desc: 'Copy from current system configuration' },
            { option: 'startup-config', desc: 'Copy from startup configuration' },
        ],
        'write': [
            { option: 'memory', desc: 'Write to NV memory' },
        ],
    };

    const endsWithSpace = partialInput.endsWith(' ');
    const inputWords = normalizedInput.split(/\s+/).filter(w => w);

    // 入力が空の場合 → 全コマンド一覧
    if (inputWords.length === 0) {
        const completions = getCommandCompletions('', mode);
        for (const cmd of completions) {
            const desc = commandDescriptions[cmd] || '';
            helpLines.push(`  ${cmd.padEnd(20)} ${desc}`);
        }
        return helpLines;
    }

    // スペースで終わる場合 → そのコマンドのオプションを表示
    if (endsWithSpace) {
        // 短縮コマンドを解決
        const completions = getCommandCompletions(partialInput, mode);

        // 完全一致するコマンドを見つける
        const firstWord = inputWords[0];
        const allCmds = getCommandCompletions('', mode);
        const matchedCmd = allCmds.find(c => c.startsWith(firstWord));

        if (matchedCmd && commandOptions[matchedCmd]) {
            for (const opt of commandOptions[matchedCmd]) {
                helpLines.push(`  ${opt.option.padEnd(20)} ${opt.desc}`);
            }
            return helpLines;
        }

        // オプション定義がない場合は補完結果を表示
        for (const cmd of completions) {
            const desc = commandDescriptions[cmd] || '';
            helpLines.push(`  ${cmd.padEnd(20)} ${desc}`);
        }
        return helpLines;
    }

    // 入力途中の場合
    // 1単語の途中入力 → 前方一致するコマンド一覧
    if (inputWords.length === 1) {
        const completions = getCommandCompletions(partialInput, mode);
        if (completions.length === 0) {
            helpLines.push('% Unrecognized command');
            return helpLines;
        }
        for (const cmd of completions) {
            const desc = commandDescriptions[cmd] || '';
            helpLines.push(`  ${cmd.padEnd(20)} ${desc}`);
        }
        return helpLines;
    }

    // 2単語目の途中入力 (例: 'show ver?') → 第1コマンドのオプションから前方一致を表示
    const firstWord = inputWords[0];
    const partialSecond = inputWords[1];
    const allCmds = getCommandCompletions('', mode);
    const matchedCmd = allCmds.find(c => c.startsWith(firstWord));

    if (matchedCmd && commandOptions[matchedCmd]) {
        const matchingOpts = commandOptions[matchedCmd].filter(opt =>
            opt.option.toLowerCase().startsWith(partialSecond)
        );
        if (matchingOpts.length > 0) {
            for (const opt of matchingOpts) {
                helpLines.push(`  ${opt.option.padEnd(20)} ${opt.desc}`);
            }
            return helpLines;
        }
    }

    // フォールバック: getCommandCompletionsの結果を使用
    const completions = getCommandCompletions(partialInput, mode);
    if (completions.length === 0) {
        helpLines.push('% Unrecognized command');
        return helpLines;
    }

    for (const cmd of completions) {
        const desc = commandDescriptions[cmd] || '';
        helpLines.push(`  ${cmd.padEnd(20)} ${desc}`);
    }

    return helpLines;
}
