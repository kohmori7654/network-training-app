'use client';

import React, { useCallback, useRef, useState } from 'react';
import {
    ReactFlow,
    Node,
    Edge,
    Controls,
    Background,
    useNodesState,
    useEdgesState,
    addEdge,
    Connection,
    NodeTypes,
    BackgroundVariant,
    ReactFlowProvider,
    useReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import useNetworkStore, { createL2Switch, createL3Switch, createPC } from '@/stores/useNetworkStore';
import L2SwitchNode from './nodes/L2SwitchNode';
import L3SwitchNode from './nodes/L3SwitchNode';
import PCNode from './nodes/PCNode';
import PortSelectModal from './PortSelectModal';

// カスタムノード定義
const nodeTypes: NodeTypes = {
    'l2-switch': L2SwitchNode,
    'l3-switch': L3SwitchNode,
    'pc': PCNode,
};

interface PendingConnection {
    sourceId: string;
    targetId: string;
}

function NetworkCanvasInner() {
    const reactFlowWrapper = useRef<HTMLDivElement>(null);
    const { screenToFlowPosition } = useReactFlow();

    const {
        devices,
        connections,
        addDevice,
        updateDevicePosition,
        connectPorts,
        selectDevice,
        removeConnection,
    } = useNetworkStore();

    const [portSelectModal, setPortSelectModal] = useState<{
        open: boolean;
        sourceDeviceId: string;
        targetDeviceId: string;
        sourceHandle?: string | null;
        targetHandle?: string | null;
    }>({ open: false, sourceDeviceId: '', targetDeviceId: '' });

    // デバイスをReact Flowノードに変換
    const initialNodes: Node[] = devices.map((device) => ({
        id: device.id,
        type: device.type,
        position: device.position,
        data: { device },
    }));

    // 接続をReact Flowエッジに変換
    const initialEdges: Edge[] = connections.map((conn) => ({
        id: conn.id,
        source: conn.sourceDeviceId,
        target: conn.targetDeviceId,
        sourceHandle: conn.sourceHandle,
        targetHandle: conn.targetHandle,
        type: 'smoothstep', // ケーブルが機器の下を通らないように直角ルーティング
        pathOptions: { borderRadius: 20, offset: 20 },
        animated: conn.status === 'up',
        style: { stroke: conn.status === 'up' ? '#22c55e' : '#ef4444', strokeWidth: 2 },
    }));

    const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
    const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

    // ノードの衝突判定（重なり防止）
    const handleNodesChange = useCallback(
        (changes: any) => {
            const NEXT_NODES = [...nodes];
            // バッファを増やして重なりを厳格に防止
            const NODE_WIDTH = 220;
            const NODE_HEIGHT = 160;

            const filteredChanges = changes.map((change: any) => {
                if (change.type === 'position' && change.position && change.dragging) {
                    const targetNode = NEXT_NODES.find((n) => n.id === change.id);
                    if (!targetNode) return change;

                    const newX = change.position.x;
                    const newY = change.position.y;

                    // 他のノードとの衝突チェック
                    const hasCollision = NEXT_NODES.some((n) => {
                        if (n.id === change.id) return false;

                        const dx = Math.abs(newX - n.position.x);
                        const dy = Math.abs(newY - n.position.y);

                        // 矩形の重なり判定
                        return dx < NODE_WIDTH && dy < NODE_HEIGHT;
                    });

                    if (hasCollision) {
                        return null;
                    }
                }
                return change;
            }).filter(Boolean);

            onNodesChange(filteredChanges);
        },
        [nodes, onNodesChange]
    );

    // ストアの変更を監視してローカルステートを更新
    React.useEffect(() => {
        // ... (existing logic) ...
        // Note: This overrides local state. We need to be careful not to fight with React Flow's internal state during drag.
        // Currently, store updates happening via onNodeDragStop, so visual drag is local.
        const newNodes: Node[] = devices.map((device) => {
            // 既存のノードがあれば、その位置情報を維持するか、ストアの位置を採用するか？
            // ストアの位置は onNodeDragStop で更新されるため、ドラッグ中はローカルが先行するが、
            // 他の要因でデバイスが増減した場合は同期が必要。
            // ここでは単純にマッピングする。
            return {
                id: device.id,
                type: device.type,
                position: device.position,
                data: { device },
            };
        });

        // deep compare or just set? setNodes handles diffing internally mostly.
        // However, setting nodes creates a new array reference.
        // We should check if devices changed meaningfully?
        // For now, keep it simple.
        setNodes(newNodes);
    }, [devices, setNodes]);

    React.useEffect(() => {
        const newEdges: Edge[] = connections.map((conn) => ({
            id: conn.id,
            source: conn.sourceDeviceId,
            target: conn.targetDeviceId,
            sourceHandle: conn.sourceHandle,
            targetHandle: conn.targetHandle,
            type: 'smoothstep', // Update here too
            pathOptions: { borderRadius: 20, offset: 20 },
            animated: conn.status === 'up',
            style: { stroke: conn.status === 'up' ? '#22c55e' : '#ef4444', strokeWidth: 2 },
        }));
        setEdges(newEdges);
    }, [connections, setEdges]);

    // ノード位置変更時
    const onNodeDragStop = useCallback(
        (_: React.MouseEvent, node: Node) => {
            updateDevicePosition(node.id, node.position);
        },
        [updateDevicePosition]
    );

    // ノードクリック時
    const onNodeClick = useCallback(
        (_: React.MouseEvent, node: Node) => {
            selectDevice(node.id);
        },
        [selectDevice]
    );

    // 接続作成時（ポート選択モーダルを表示）
    const onConnect = useCallback(
        (params: Connection) => {
            if (params.source && params.target) {
                setPortSelectModal({
                    open: true,
                    sourceDeviceId: params.source,
                    targetDeviceId: params.target,
                    sourceHandle: params.sourceHandle,
                    targetHandle: params.targetHandle,
                });
            }
        },
        []
    );

    // ポート選択完了時
    const handlePortSelect = useCallback(
        (sourcePortId: string, targetPortId: string) => {
            connectPorts(
                portSelectModal.sourceDeviceId,
                sourcePortId,
                portSelectModal.targetDeviceId,
                targetPortId,
                portSelectModal.sourceHandle || undefined,
                portSelectModal.targetHandle || undefined
            );
            setPortSelectModal({ open: false, sourceDeviceId: '', targetDeviceId: '' });
        },
        [connectPorts, portSelectModal]
    );

    // エッジ削除時
    const onEdgeClick = useCallback(
        (_: React.MouseEvent, edge: Edge) => {
            if (confirm('この接続を削除しますか？')) {
                removeConnection(edge.id);
            }
        },
        [removeConnection]
    );

    // ドラッグ＆ドロップでデバイス追加
    const onDragOver = useCallback((event: React.DragEvent) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
    }, []);

    const onDrop = useCallback(
        (event: React.DragEvent) => {
            event.preventDefault();

            const type = event.dataTransfer.getData('application/device-type');
            if (!type) return;

            const position = screenToFlowPosition({
                x: event.clientX,
                y: event.clientY,
            });

            let device;
            const timestamp = Date.now().toString(36).slice(-4).toUpperCase();

            switch (type) {
                case 'l2-switch':
                    device = createL2Switch(`SW-${timestamp}`, position);
                    break;
                case 'l3-switch':
                    device = createL3Switch(`L3SW-${timestamp}`, position);
                    break;
                case 'pc':
                    device = createPC(`PC-${timestamp}`, position);
                    break;
                default:
                    return;
            }

            addDevice(device);
        },
        [screenToFlowPosition, addDevice]
    );

    return (
        <div ref={reactFlowWrapper} className="w-full h-full">
            <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={handleNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                onNodeDragStop={onNodeDragStop}
                onNodeClick={onNodeClick}
                onEdgeClick={onEdgeClick}
                onDragOver={onDragOver}
                onDrop={onDrop}
                nodeTypes={nodeTypes}
                fitView
                className="bg-slate-900"
            >
                <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#475569" />
                <Controls className="bg-slate-800 border-slate-700" />
            </ReactFlow>

            <PortSelectModal
                open={portSelectModal.open}
                onClose={() => setPortSelectModal({ open: false, sourceDeviceId: '', targetDeviceId: '' })}
                sourceDeviceId={portSelectModal.sourceDeviceId}
                targetDeviceId={portSelectModal.targetDeviceId}
                onSelect={handlePortSelect}
            />
        </div>
    );
}

export default function NetworkCanvas() {
    return (
        <ReactFlowProvider>
            <NetworkCanvasInner />
        </ReactFlowProvider>
    );
}
