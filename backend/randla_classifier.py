#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
RandLA-Net neural network model definition for point cloud segmentation.

This module contains the RandLA-Net architecture (CVPR 2022) for when
PyTorch is available with pre-trained weights. The actual classification
pipeline is in classify.py (which uses geometric analysis as the primary
approach when no pre-trained model is available).

Paper: "RandLA-Net: Efficient Large-Scale Point Cloud Semantic Segmentation"
"""

import sys
import numpy as np

try:
    import torch
    import torch.nn as nn
    import torch.nn.functional as F
    TORCH_AVAILABLE = True
except ImportError:
    TORCH_AVAILABLE = False

# Category config shared with classify.py
CATEGORY_CONFIG = {
    'ground':         {'label': 'Ground',        'color': '#D97706', 'idx': 0},
    'tree':           {'label': 'Tree',          'color': '#22C55E', 'idx': 1},
    'building':       {'label': 'Building',      'color': '#EF4444', 'idx': 2},
    'low_vegetation': {'label': 'LowVegetation',  'color': '#34D399', 'idx': 3},
    'other':          {'label': 'Other',          'color': '#6B7280', 'idx': 4},
}
CATEGORY_KEYS = list(CATEGORY_CONFIG.keys())
NUM_CLASSES = len(CATEGORY_KEYS)


# ================================================================
# RandLA-Net Architecture
# ================================================================
if TORCH_AVAILABLE:

    class LocalSpatialEncoding(nn.Module):
        """Local Spatial Encoding (LSE): relative coords + distance + angles → MLP → MaxPool"""
        def __init__(self, k=16, out_channels=32):
            super().__init__()
            self.k = k
            self.mlp = nn.Sequential(
                nn.Linear(6, out_channels),
                nn.ReLU(),
                nn.BatchNorm1d(out_channels),
            )

        def forward(self, points):
            N = points.shape[0]
            k = min(self.k, max(1, N - 1))
            device = points.device

            if N <= 2048:
                diff = points.unsqueeze(0) - points.unsqueeze(1)
                dist = torch.norm(diff, dim=-1)
                dist.fill_diagonal_(1e9)
                _, idx = dist.topk(k, largest=False, dim=-1)
                idx_expand = idx.unsqueeze(-1).expand(-1, -1, 3)
                relative = torch.gather(diff, 1, idx_expand)
            else:
                idx = torch.randint(0, N, (N, k), device=device)
                neighbor = points[idx]
                relative = neighbor - points.unsqueeze(1)

            dist = torch.norm(relative, dim=-1, keepdim=True)
            azimuth = torch.atan2(relative[..., 1:2], relative[..., 0:1] + 1e-8)
            polar = torch.acos(torch.clamp(relative[..., 2:3] / (dist + 1e-8), -1, 1))
            lse_input = torch.cat([relative, dist, azimuth, polar], dim=-1)

            encoded = self.mlp(lse_input.reshape(-1, 6)).reshape(N, k, -1)
            return torch.max(encoded, dim=1)[0]


    class PointMLPBlock(nn.Module):
        """PointMLP block: Linear → ReLU → BN → Linear → ReLU → BN"""
        def __init__(self, in_c, out_c):
            super().__init__()
            self.net = nn.Sequential(
                nn.Linear(in_c, out_c),
                nn.ReLU(),
                nn.BatchNorm1d(out_c),
                nn.Linear(out_c, out_c),
                nn.ReLU(),
                nn.BatchNorm1d(out_c),
            )

        def forward(self, x):
            return self.net(x)


    class ProgressiveEncoder(nn.Module):
        """Progressive Feature Encoder: (3+32) → 64 → 128 → 256"""
        def __init__(self, in_channels=3, lse_channels=32):
            super().__init__()
            self.stage1 = PointMLPBlock(in_channels + lse_channels, 64)
            self.stage2 = PointMLPBlock(64, 128)
            self.stage3 = PointMLPBlock(128, 256)

        def forward(self, x):
            f1 = self.stage1(x)
            f2 = self.stage2(f1)
            f3 = self.stage3(f2)
            return f1, f2, f3


    class AttentionAggregation(nn.Module):
        """Attention-based Feature Aggregation"""
        def __init__(self, embed_dim=256, num_heads=8, dropout=0.2):
            super().__init__()
            self.attn = nn.MultiheadAttention(
                embed_dim=embed_dim, num_heads=num_heads,
                dropout=dropout, batch_first=True,
            )
            self.norm = nn.LayerNorm(embed_dim)

        def forward(self, x):
            inp = x.unsqueeze(0)
            attn_out, _ = self.attn(inp, inp, inp)
            attn_out = self.norm(inp + attn_out)
            return attn_out.squeeze(0)


    class ProgressiveDecoder(nn.Module):
        """Progressive Feature Decoder: 256 → 128 → 64 → 32"""
        def __init__(self):
            super().__init__()
            self.up3 = nn.Sequential(nn.Linear(256, 128), nn.ReLU(), nn.BatchNorm1d(128))
            self.up2 = nn.Sequential(nn.Linear(128, 64), nn.ReLU(), nn.BatchNorm1d(64))
            self.up1 = nn.Sequential(nn.Linear(64, 32), nn.ReLU())

        def forward(self, x):
            x = self.up3(x)
            x = self.up2(x)
            x = self.up1(x)
            return x


    class RandLANet(nn.Module):
        """
        RandLA-Net point cloud semantic segmentation network.
        
        Pipeline:
          Input points → LSE → Concat coords → Encoder → Attention → Decoder → Classifier
        """
        def __init__(self, in_channels=3, num_classes=5, k_neighbors=16, dropout=0.2):
            super().__init__()
            self.lse = LocalSpatialEncoding(k=k_neighbors, out_channels=32)
            self.encoder = ProgressiveEncoder(in_channels, 32)
            self.attention = AttentionAggregation(embed_dim=256, num_heads=8, dropout=dropout)
            self.decoder = ProgressiveDecoder()
            self.classifier = nn.Sequential(
                nn.Linear(32, 16),
                nn.ReLU(),
                nn.Dropout(dropout),
                nn.Linear(16, num_classes),
            )

        def forward(self, points):
            lse_feat = self.lse(points)
            feat = torch.cat([points, lse_feat], -1)
            f1, f2, f3 = self.encoder(feat)
            fused = self.attention(f3)
            decoded = self.decoder(fused)
            logits = self.classifier(decoded)
            return logits


    class RandLANetClassifier:
        """
        RandLA-Net classifier with pre-trained weights support.
        
        Note: For actual classification without pre-trained weights,
        use classify.py which implements a geometric classifier
        that works without training data.
        """
        def __init__(self, model_path=None, device='auto', num_classes=NUM_CLASSES):
            self.device = self._get_device(device)
            self.model = None
            self.model_path = model_path
            self.num_classes = num_classes
            self._model_loaded = False

        def _get_device(self, device):
            if not TORCH_AVAILABLE:
                return 'cpu'
            if device == 'auto':
                return 'cuda' if torch.cuda.is_available() else 'cpu'
            return device

        def load_model(self):
            if self._model_loaded:
                return True
            if not TORCH_AVAILABLE:
                print("[RandLA-Net] PyTorch not available", file=sys.stderr)
                self._model_loaded = True
                return False

            try:
                self.model = RandLANet(
                    in_channels=3, num_classes=self.num_classes,
                    k_neighbors=16, dropout=0.2,
                )
                if self.model_path:
                    ckpt = torch.load(self.model_path, map_location=self.device, weights_only=False)
                    state = ckpt.get('model_state_dict', ckpt) if isinstance(ckpt, dict) else ckpt
                    self.model.load_state_dict(state, strict=False)
                    print(f"[RandLA-Net] Loaded weights: {self.model_path}", file=sys.stderr)
                else:
                    print("[RandLA-Net] Using randomly initialized model (no pretrained weights)",
                          file=sys.stderr)

                self.model = self.model.to(self.device)
                self.model.eval()
                self._model_loaded = True
                return True
            except Exception as e:
                print(f"[RandLA-Net] Model load failed: {e}", file=sys.stderr)
                self._model_loaded = True
                return False

        def inference(self, points, batch_size=2048):
            if self.model is None:
                return np.full(len(points), 4, dtype=np.int32)

            self.model.eval()
            mean = points.mean(axis=0)
            std = points.std(axis=0) + 1e-8
            norm = (points - mean) / std
            inp = torch.FloatTensor(norm).to(self.device)

            all_logits = []
            with torch.no_grad():
                for i in range(0, len(points), batch_size):
                    batch = inp[i:i + batch_size]
                    logits = self.model(batch)
                    all_logits.append(logits.cpu().numpy())

            logits = np.concatenate(all_logits, axis=0)
            return np.argmax(logits, axis=1).astype(np.int32)

else:
    # PyTorch not available - provide stub classes
    class RandLANetClassifier:
        def __init__(self, **kwargs):
            self._model_loaded = True
            self._use_rule_based = True

        def load_model(self):
            print("[RandLA-Net] PyTorch not available, using geometric classifier",
                  file=sys.stderr)
            return False

        def inference(self, points, **kwargs):
            # Returns empty - actual classification done by classify.py
            return np.full(len(points), 4, dtype=np.int32)
