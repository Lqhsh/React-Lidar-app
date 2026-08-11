import express from 'express'
import multer from 'multer'
import { execFile } from 'child_process'
import fs from 'fs'
import path from 'path'

// 创建 Express 应用实例
const app = express()
const PORT = parseInt(process.env.PORT || '3001', 10)

// ES Module 中获取 __dirname 的兼容写法
const __dirname = decodeURIComponent(path.dirname(new URL(import.meta.url).pathname)).replace(/^\/([A-Za-z]:)/, '$1')

// 虚拟环境 Python 路径
const pythonPath = path.join(__dirname, 'venv', 'Scripts', 'python.exe')

// 上传文件目录和输出目录
const uploadDir = path.join(__dirname, 'uploads')
const outputDir = path.join(__dirname, 'output')

// 确保目录存在
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true })
}
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true })
}

// 健康检查端点
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() })
})

// 本地数据目录路径（项目根目录下的 本地数据 文件夹）
const localDataDir = path.join(__dirname, '..', '本地数据')

// 列出本地数据文件
app.get('/api/local-data', (req, res) => {
  if (!fs.existsSync(localDataDir)) {
    return res.json({ files: [], message: '本地数据目录不存在' })
  }
  
  try {
    const entries = fs.readdirSync(localDataDir, { withFileTypes: true })
    const files = entries
      .filter(e => e.isFile() && /\.(las|laz|ply|pcd|bin|csv|txt|xyz)$/i.test(e.name))
      .map(e => {
        const filePath = path.join(localDataDir, e.name)
        const stat = fs.statSync(filePath)
        return {
          name: e.name,
          size: stat.size,
          modified: stat.mtime,
          ext: path.extname(e.name).toLowerCase().slice(1),
        }
      })
    files.sort((a, b) => b.modified.getTime() - a.modified.getTime())
    res.json({ files })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// 加载本地数据文件（以二进制流返回）
app.get('/api/local-data-file/:filename', (req, res) => {
  const { filename } = req.params
  if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    return res.status(400).json({ error: '非法文件名' })
  }
  
  const filePath = path.join(localDataDir, filename)
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: '文件不存在' })
  }
  
  const stat = fs.statSync(filePath)
  res.setHeader('Content-Type', 'application/octet-stream')
  res.setHeader('Content-Length', stat.size)
  res.setHeader('X-File-Name', encodeURIComponent(filename))
  fs.createReadStream(filePath).pipe(res)
})

// Python 环境检查端点
app.get('/api/check-python', (req, res) => {
  execFile(pythonPath, ['--version'], (error, stdout, stderr) => {
    if (error) {
      return res.json({
        pythonAvailable: false,
        error: stderr || error.message,
        suggestion: '请确保虚拟环境已创建并安装必要模块'
      })
    }

    execFile(pythonPath, ['-c', 'import laspy; print(laspy.__version__)'], (laspyError, laspyStdout, laspyStderr) => {
      if (laspyError) {
        return res.json({
          pythonAvailable: true,
          pythonVersion: stdout.trim(),
          laspyAvailable: false,
          error: laspyStderr || laspyError.message,
          suggestion: '请在虚拟环境中安装laspy模块: pip install laspy'
        })
      }

      res.json({
        pythonAvailable: true,
        pythonVersion: stdout.trim(),
        laspyAvailable: true,
        laspyVersion: laspyStdout.trim()
      })
    })
  })
})

// Multer 配置：文件存储位置和命名规则
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadDir)
  },
  filename: (_req, file, cb) => {
    cb(null, `${Date.now()}_${file.originalname}`)
  }
})

const upload = multer({ storage })

app.use(express.json({ limit: '50mb' }))
app.use('/api/filter', express.raw({ limit: '100mb', type: 'application/octet-stream' }))
app.use('/api/filter-separate', express.raw({ limit: '100mb', type: 'application/octet-stream' }))

/**
 * LAS 文件上传和解析接口（兼容旧版，使用simple模式）
 */
app.post('/api/upload', upload.single('lasfile'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' })
  }

  const inputPath = req.file.path
  const fileId = path.basename(inputPath).split('_')[0]
  const outputPath = path.join(outputDir, `${fileId}.bin`)

  execFile(pythonPath, [
    path.join(__dirname, 'parse_las.py'),
    'simple',
    inputPath,
    '-o', outputPath
  ], (error, _stdout, stderr) => {
    if (error) {
      console.error('Parse error:', stderr)
      return res.status(500).json({ error: stderr || error.message })
    }

    console.log('Parse success:', stderr)

    fs.readFile(outputPath, (readError, data) => {
      if (readError) {
        return res.status(500).json({ error: readError.message })
      }

      res.setHeader('Content-Type', 'application/octet-stream')
      res.setHeader('X-File-Id', fileId)
      res.send(data)

      setTimeout(() => {
        try { fs.unlinkSync(inputPath) } catch { /* ignore */ }
        try { fs.unlinkSync(outputPath) } catch { /* ignore */ }
      }, 60000)
    })
  })
})

/**
 * LAS 文件头信息读取接口
 * 仅读取 LAS 文件头，返回版本、点格式、可用字段列表等元数据
 */
app.post('/api/las-header', upload.single('lasfile'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' })
  }

  const inputPath = req.file.path

  execFile(pythonPath, [
    path.join(__dirname, 'parse_las.py'),
    'header',
    inputPath,
  ], (error, stdout, stderr) => {
    // 清理临时文件
    setTimeout(() => {
      try { fs.unlinkSync(inputPath) } catch { /* ignore */ }
    }, 30000)

    if (error) {
      console.error('Header read error:', stderr)
      try {
        const errObj = JSON.parse(stderr)
        return res.status(500).json(errObj)
      } catch {
        return res.status(500).json({ error: stderr || error.message })
      }
    }

    try {
      const headerInfo = JSON.parse(stdout)
      res.json(headerInfo)
    } catch (parseErr) {
      console.error('Header parse error:', parseErr, 'stdout:', stdout)
      res.status(500).json({ error: 'Failed to parse header info' })
    }
  })
})

/**
 * LAS 文件按字段解析接口
 * 前端通过 FormData 上传：
 *   - lasfile: 二进制文件
 *   - fields: JSON 字符串，如 ["Intensity","Classification"]
 *   - shift: JSON 字符串，如 {"x":0,"y":0,"z":0}
 *   - ignoreDefault: "true" / "false"
 *   - force8bitColors: "true" / "false"
 */
app.post('/api/las-parse', upload.single('lasfile'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' })
  }

  const inputPath = req.file.path
  const fileId = path.basename(inputPath).split('_')[0]
  const outputPath = path.join(outputDir, `${fileId}.bin`)

  // 从 FormData 读取字符串字段并解析
  let fields: string[] = []
  let shift: Record<string, number> | null = null
  let ignoreDefault = false
  let force8bitColors = false

  try {
    if (req.body?.fields) {
      const parsed = JSON.parse(req.body.fields)
      if (Array.isArray(parsed)) fields = parsed
    }
  } catch { /* ignore */ }

  try {
    if (req.body?.shift) {
      const parsed = JSON.parse(req.body.shift)
      if (parsed && typeof parsed === 'object') shift = parsed
    }
  } catch { /* ignore */ }

  ignoreDefault = req.body?.ignoreDefault === 'true' || req.body?.ignoreDefault === '1'
  force8bitColors = req.body?.force8bitColors === 'true' || req.body?.force8bitColors === '1'
  
  // 读取加载模式参数
  const loadMode = req.body?.loadMode === 'chunked' ? 'chunked' : 'full'
  const maxPoints = req.body?.maxPoints ? parseInt(req.body.maxPoints, 10) : null

  const command = loadMode === 'chunked' ? 'chunked' : 'parse'
  
  const args = [
    path.join(__dirname, 'parse_las.py'),
    command,
    inputPath,
    '-o', outputPath,
  ]

  if (fields.length > 0) {
    args.push('-f', fields.join(','))
  }

  if (shift) {
    args.push('-s', JSON.stringify(shift))
  }

  if (ignoreDefault) {
    args.push('--ignore-default')
  }

  if (force8bitColors) {
    args.push('--force-8bit')
  }
  
  // 分块加载模式添加额外参数
  if (loadMode === 'chunked') {
    args.push('--chunk-size', '500000')
    if (maxPoints && maxPoints > 0) {
      args.push('--max-points', String(maxPoints))
    }
  }

  execFile(pythonPath, args, (error, _stdout, stderr) => {
    // 清理临时上传文件
    setTimeout(() => {
      try { fs.unlinkSync(inputPath) } catch { /* ignore */ }
    }, 1000)

    if (error) {
      console.error('LAS parse error:', stderr)
      // 尝试读取 stderr 最后一行的 JSON 错误
      try {
        const lines = (stderr || '').split('\n').filter(l => l.trim())
        for (let i = lines.length - 1; i >= 0; i--) {
          const line = lines[i].trim()
          if (line.startsWith('{') && line.endsWith('}')) {
            const errObj = JSON.parse(line)
            return res.status(500).json({ error: errObj.error || errObj.message || error.message })
          }
        }
      } catch { /* ignore */ }
      return res.status(500).json({ error: stderr || error.message })
    }

    // 解析 stderr 获取元数据（最后一行 JSON）
    let metaInfo: Record<string, any> = {}
    try {
      const lines = stderr.split('\n').filter(l => l.trim())
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i].trim()
        if (line.startsWith('{') && line.endsWith('}')) {
          metaInfo = JSON.parse(line)
          break
        }
      }
    } catch (e) {
      console.error('Parse meta info error:', e)
    }

    // 读取二进制输出
    fs.readFile(outputPath, (readError, data) => {
      if (readError) {
        return res.status(500).json({ error: readError.message })
      }

      res.setHeader('Content-Type', 'application/octet-stream')
      res.setHeader('X-Meta-Info', encodeURIComponent(JSON.stringify(metaInfo)))
      res.send(data)

      // 清理输出文件
      setTimeout(() => {
        try { fs.unlinkSync(outputPath) } catch { /* ignore */ }
      }, 60000)
    })
  })
})

/**
 * BIN 文件上传和解析接口
 * 接收前端上传的 BIN 文件，根据指定格式解析并返回数据
 */
app.post('/api/bin-parse', upload.single('binfile'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' })
  }

  const inputPath = req.file.path
  const format = req.body?.format || 'xyz'

  fs.readFile(inputPath, (readError, data) => {
    setTimeout(() => {
      try { fs.unlinkSync(inputPath) } catch { /* ignore */ }
    }, 60000)

    if (readError) {
      return res.status(500).json({ error: readError.message })
    }

    res.setHeader('Content-Type', 'application/octet-stream')
    res.setHeader('X-Bin-Format', format)
    res.send(data)
  })
})

function sanitizeFileName(name: string) {
  return name
    .replace(/[^a-zA-Z0-9\u4e00-\u9fa5_.-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
}

app.post('/api/las-export', express.raw({ limit: '500mb', type: 'application/octet-stream' }), (req, res) => {
  try {
    const buffer = req.body as Buffer
    if (!buffer || !Buffer.isBuffer(buffer) || buffer.length === 0) {
      return res.status(400).json({ error: '无效的点云数据' })
    }

    const rawFileName = typeof req.query.fileName === 'string' ? req.query.fileName : 'pointcloud'
    const fileBaseName = sanitizeFileName(rawFileName.replace(/\.[^.]+$/, '')) || 'pointcloud'
    const pointCount = parseInt(req.headers['x-point-count'] as string, 10) || 0
    const hasColors = req.headers['x-has-colors'] === '1'
    const hasIntensity = req.headers['x-has-intensity'] === '1'
    const hasClassification = req.headers['x-has-classification'] === '1'

    const exportDir = path.join(outputDir, `las-export-${Date.now()}`)
    fs.mkdirSync(exportDir, { recursive: true })

    const inputPath = path.join(exportDir, 'input.bin')
    const outputPath = path.join(exportDir, `${fileBaseName}.las`)
    fs.writeFileSync(inputPath, buffer)

    const args = [
      path.join(__dirname, 'las_export.py'),
      inputPath,
      outputPath,
      '--point-count', pointCount.toString(),
      '--has-colors', hasColors ? '1' : '0',
      '--has-intensity', hasIntensity ? '1' : '0',
      '--has-classification', hasClassification ? '1' : '0',
    ]

    execFile(pythonPath, args, {
      cwd: __dirname,
      encoding: 'utf8',
      maxBuffer: 500 * 1024 * 1024,
      timeout: 300000,
    }, (error: any, _stdout: string, stderr: string) => {
      if (error) {
        console.error('LAS export exec error:', error.message)
        console.error('LAS export stderr:', stderr)
        return res.status(500).json({ error: error.message || stderr || 'LAS 导出执行失败' })
      }

      fs.readFile(outputPath, (readError, data) => {
        if (readError) {
          return res.status(500).json({ error: readError.message })
        }

        res.setHeader('Content-Type', 'application/octet-stream')
        res.send(data)

        setTimeout(() => {
          try { fs.unlinkSync(inputPath) } catch { /* ignore */ }
          try { fs.unlinkSync(outputPath) } catch { /* ignore */ }
          try { fs.rmdirSync(exportDir) } catch { /* ignore */ }
        }, 60000)
      })
    })
  } catch (error: any) {
    console.error('LAS export request error:', error)
    res.status(500).json({ error: error.message })
  }
})

/**
 * 点云滤波接口（单输出）
 */
app.post('/api/filter', (req, res) => {
  try {
    const buffer = req.body

    if (!buffer || buffer.length < 16) {
      return res.status(400).json({ error: 'Invalid input data' })
    }

    const method = req.headers['x-filter-method'] as string || 'statistical'
    const paramsJson = req.headers['x-filter-params'] as string || '{}'

    let params: Record<string, any>
    try {
      params = JSON.parse(paramsJson)
    } catch {
      params = {}
    }

    const inputPath = path.join(outputDir, `filter_input_${Date.now()}.bin`)
    const outputPath = path.join(outputDir, `filter_output_${Date.now()}.bin`)

    fs.writeFile(inputPath, buffer, (writeError) => {
      if (writeError) {
        console.error('Write error:', writeError)
        return res.status(500).json({ error: writeError.message })
      }

      execFile(pythonPath, [
        path.join(__dirname, 'filters.py'),
        inputPath,
        outputPath,
        method,
        JSON.stringify(params)
      ], (error, _stdout, stderr) => {
        if (error) {
          console.error('Filter error:', stderr)
          try { fs.unlinkSync(inputPath) } catch { /* ignore */ }
          return res.status(500).json({ error: stderr || error.message })
        }

        console.log('Filter success:', stderr)

        fs.readFile(outputPath, (readError, data) => {
          if (readError) {
            try { fs.unlinkSync(inputPath) } catch { /* ignore */ }
            return res.status(500).json({ error: readError.message })
          }

          res.setHeader('Content-Type', 'application/octet-stream')
          res.send(data)

          setTimeout(() => {
            try { fs.unlinkSync(inputPath) } catch { /* ignore */ }
            try { fs.unlinkSync(outputPath) } catch { /* ignore */ }
          }, 60000)
        })
      })
    })
  } catch (error: any) {
    console.error('Filter request error:', error)
    res.status(500).json({ error: error.message })
  }
})

/**
 * CSF分离滤波接口
 * 返回地面点和非地面点两个文件
 */
app.post('/api/filter-separate', (req, res) => {
  try {
    const buffer = req.body

    if (!buffer || buffer.length < 16) {
      return res.status(400).json({ error: 'Invalid input data' })
    }

    const method = req.headers['x-filter-method'] as string || 'csf_separate'
    const paramsJson = req.headers['x-filter-params'] as string || '{}'

    let params: Record<string, any>
    try {
      params = JSON.parse(paramsJson)
    } catch {
      params = {}
    }

    const inputPath = path.join(outputDir, `filter_sep_input_${Date.now()}.bin`)
    const outputPath = path.join(outputDir, `filter_sep_output_${Date.now()}`)

    fs.writeFile(inputPath, buffer, (writeError) => {
      if (writeError) {
        console.error('Write error:', writeError)
        return res.status(500).json({ error: writeError.message })
      }

      execFile(pythonPath, [
        path.join(__dirname, 'filters.py'),
        inputPath,
        outputPath,
        method,
        '--separate',
        JSON.stringify(params)
      ], (error, _stdout, stderr) => {
        if (error) {
          console.error('Separate filter error:', stderr)
          try { fs.unlinkSync(inputPath) } catch { /* ignore */ }
          return res.status(500).json({ error: stderr || error.message })
        }

        console.log('Separate filter success:', stderr)

        let resultInfo = { ground_count: 0, non_ground_count: 0 }
        try {
          const lines = stderr.split('\n').filter(l => l.trim())
          const lastLine = lines[lines.length - 1]
          if (lastLine.startsWith('{')) {
            resultInfo = JSON.parse(lastLine)
          }
        } catch (e) {
          console.error('Parse result info error:', e)
        }

        const groundPath = outputPath + '_ground.bin'
        const nonGroundPath = outputPath + '_nonground.bin'

        const groundData = fs.existsSync(groundPath) ? fs.readFileSync(groundPath) : Buffer.alloc(0)
        const nonGroundData = fs.existsSync(nonGroundPath) ? fs.readFileSync(nonGroundPath) : Buffer.alloc(0)

        try { fs.unlinkSync(inputPath) } catch { /* ignore */ }
        setTimeout(() => {
          try { fs.unlinkSync(groundPath) } catch { /* ignore */ }
          try { fs.unlinkSync(nonGroundPath) } catch { /* ignore */ }
        }, 60000)

        res.json({
          ground: {
            count: resultInfo.ground_count || 0,
            data: groundData.toString('base64')
          },
          nonGround: {
            count: resultInfo.non_ground_count || 0,
            data: nonGroundData.toString('base64')
          }
        })
      })
    })
  } catch (error: any) {
    console.error('Separate filter request error:', error)
    res.status(500).json({ error: error.message })
  }
})

/**
 * 高度归一化接口
 * 接收点云二进制数据 (N×3 float32)，返回归一化后的点云
 * 请求头:
 *   x-resolution: 网格分辨率 (米)
 */
app.post('/api/height-normalize', express.raw({ limit: '200mb', type: 'application/octet-stream' }), (req, res) => {
  try {
    const buffer = req.body

    if (!buffer || buffer.length < 12) {
      return res.status(400).json({ error: 'Invalid input data: need at least 12 bytes (1 point × 3 floats)' })
    }

    const resolution = parseFloat(req.headers['x-resolution'] as string) || 1.0
    const pointCount = Math.floor(buffer.length / 12)

    const inputPath = path.join(outputDir, `hn_input_${Date.now()}.bin`)
    const outputPath = path.join(outputDir, `hn_output_${Date.now()}.bin`)

    fs.writeFile(inputPath, buffer, (writeError) => {
      if (writeError) {
        console.error('Height normalize write error:', writeError)
        return res.status(500).json({ error: writeError.message })
      }

      execFile(pythonPath, [
        path.join(__dirname, 'height_normalize.py'),
        inputPath,
        outputPath,
        '--resolution', resolution.toString(),
      ], (error, _stdout, stderr) => {
        // 清理输入文件
        try { fs.unlinkSync(inputPath) } catch { /* ignore */ }

        if (error) {
          console.error('Height normalize error:', stderr)
          return res.status(500).json({ error: stderr || error.message })
        }

        // 解析 stderr 获取元数据
        let metaInfo: Record<string, any> = {}
        try {
          const lines = stderr.split('\n').filter(l => l.trim())
          for (let i = lines.length - 1; i >= 0; i--) {
            const line = lines[i].trim()
            if (line.startsWith('{') && line.endsWith('}')) {
              metaInfo = JSON.parse(line)
              break
            }
          }
        } catch (e) {
          console.error('Parse height normalize meta error:', e)
        }

        // 读取输出文件
        fs.readFile(outputPath, (readError, data) => {
          if (readError) {
            return res.status(500).json({ error: readError.message })
          }

          res.setHeader('Content-Type', 'application/octet-stream')
          res.setHeader('X-Meta-Info', encodeURIComponent(JSON.stringify({
            ...metaInfo,
            pointCount,
            inputBytes: buffer.length,
          })))
          res.send(data)

          setTimeout(() => {
            try { fs.unlinkSync(outputPath) } catch { /* ignore */ }
          }, 60000)
        })
      })
    })
  } catch (error: any) {
    console.error('Height normalize request error:', error)
    res.status(500).json({ error: error.message })
  }
})

// 地物分类与个体分割接口
// 将点云按高程分为地面/灌木/树木/建筑/其他，并对每个独立对象
// （每棵树、每栋楼）做 DBSCAN 聚类，分割成单独实例
// 每个实例保存为独立文件，返回每个实例的数据与命名信息
app.post('/api/classify', express.raw({ limit: '200mb', type: 'application/octet-stream' }), (req, res) => {
  try {
    const buffer = req.body

    if (!buffer || buffer.length < 12) {
      return res.status(400).json({ error: '无效输入：至少需要 12 字节（1 个点 × 3 个浮点数）' })
    }

    const resolution = parseFloat(req.headers['x-resolution'] as string) || 1.0
    // DBSCAN 参数（可通过 header 覆盖）
    const eps = parseFloat(req.headers['x-eps'] as string) || 1.5
    const minSamples = parseInt(req.headers['x-min-samples'] as string) || 10
    const timestamp = Date.now()
    const clsOutputDir = path.join(outputDir, `classify_${timestamp}`)

    fs.mkdir(clsOutputDir, { recursive: true }, (mkdirErr) => {
      if (mkdirErr) {
        console.error('Classify mkdir error:', mkdirErr)
        return res.status(500).json({ error: mkdirErr.message })
      }

      const inputPath = path.join(clsOutputDir, 'input.bin')
      fs.writeFile(inputPath, buffer, (writeErr) => {
        if (writeErr) {
          console.error('Classify write error:', writeErr)
          return res.status(500).json({ error: writeErr.message })
        }

        execFile(pythonPath, [
          path.join(__dirname, 'classify.py'),
          inputPath,
          clsOutputDir,
          resolution.toString(),
          eps.toString(),
          minSamples.toString(),
        ], { cwd: __dirname, encoding: 'utf8', maxBuffer: 100 * 1024 * 1024, timeout: 300000 }, (error: any, stdout: string, stderr: string) => {
          try { fs.unlinkSync(inputPath) } catch { /* ignore */ }

          if (error) {
            console.error('Classification exec error:', error.message)
            console.error('Classification stderr:', stderr)
            return res.status(500).json({ error: error.message || stderr || '分类执行失败' })
          }

          // 解析 Python 输出的 JSON 统计信息（写在 stderr 最后一行）
          let metaInfo: any = {}
          try {
            const lines = stderr.trim().split('\n').filter(l => l.trim())
            for (let i = lines.length - 1; i >= 0; i--) {
              const line = lines[i].trim()
              if (line.startsWith('{')) {
                metaInfo = JSON.parse(line)
                break
              }
            }
          } catch (e) {
            console.error('Parse classify meta error:', e)
          }

          const instances: any[] = metaInfo.instances || []
          if (instances.length === 0) {
            return res.status(500).json({ error: '分类结果为空' })
          }

          // 读取每个实例文件，返回 base64 数据
          const results = instances.map((inst: any) => {
            const filePath = path.join(clsOutputDir, inst.file)
            try {
              const data = fs.readFileSync(filePath)
              return {
                category: inst.category,
                categoryLabel: inst.category_label,
                instanceId: inst.instance_id,
                label: inst.label,
                count: inst.count,
                zMin: inst.z_min,
                zMax: inst.z_max,
                zMean: inst.z_mean,
                data: data.toString('base64'),
              }
            } catch (readErr: any) {
              console.error(`Read ${inst.file} error:`, readErr)
              return null
            }
          }).filter(Boolean)

          // 异步清理输出目录（60 秒后）
          setTimeout(() => {
            try {
              const files = fs.readdirSync(clsOutputDir)
              for (const f of files) {
                try { fs.unlinkSync(path.join(clsOutputDir, f)) } catch { /* ignore */ }
              }
              try { fs.rmdirSync(clsOutputDir) } catch { /* ignore */ }
            } catch { /* ignore */ }
          }, 60000)

          res.json({
            meta: {
              totalPoints: metaInfo.total_points,
              totalInstances: metaInfo.total_instances,
              classifiedPoints: metaInfo.classified_points,
              stageCounts: metaInfo.stage_counts || {},
            },
            results,
          })
        })
      })
    })
  } catch (error: any) {
    console.error('Classify request error:', error)
    res.status(500).json({ error: error.message })
  }
})

/**
 * 单木分割接口
 * 基于树干检测与冠层分割的单木提取算法
 * 参数：trunk_straightness, trunk_curvature, min_tree_spacing, max_crown_width 等
 */
app.post('/api/tree-segment', express.raw({ limit: '200mb', type: 'application/octet-stream' }), (req, res) => {
  try {
    const buffer = req.body

    if (!buffer || buffer.length < 12) {
      return res.status(400).json({ error: '无效输入：至少需要 12 字节' })
    }

    // Parse parameters from header
    const params: any = {}
    const paramsStr = req.headers['x-params'] as string
    if (paramsStr) {
      try {
        const parsed = JSON.parse(decodeURIComponent(paramsStr))
        Object.assign(params, parsed)
      } catch (e) { /* ignore */ }
    }

    // Default parameters based on reference workflow
    const defaults = {
      trunk_straightness: 0.65,
      trunk_curvature: 0.15,
      min_tree_spacing: 0.5,
      max_crown_width: 1.5,
      min_tree_height: 1.0,
      max_tree_height: 30.0,
    }
    for (const [k, v] of Object.entries(defaults)) {
      if (params[k] === undefined || params[k] === null) {
        params[k] = v
      } else {
        params[k] = Number(params[k])
      }
    }

    const timestamp = Date.now()
    const segOutputDir = path.join(outputDir, `tree_seg_${timestamp}`)

    fs.mkdir(segOutputDir, { recursive: true }, (mkdirErr) => {
      if (mkdirErr) {
        return res.status(500).json({ error: mkdirErr.message })
      }

      const inputPath = path.join(segOutputDir, 'input.bin')
      const paramsPath = path.join(segOutputDir, 'params.json')
      fs.writeFile(inputPath, buffer, (writeErr) => {
        if (writeErr) {
          return res.status(500).json({ error: writeErr.message })
        }

        fs.writeFile(paramsPath, JSON.stringify(params), 'utf8', (paramsErr) => {
          if (paramsErr) {
            return res.status(500).json({ error: paramsErr.message })
          }

          execFile(pythonPath, [
            path.join(__dirname, 'tree_segment.py'),
            inputPath,
            segOutputDir,
          ], { cwd: __dirname, encoding: 'utf8', maxBuffer: 100 * 1024 * 1024, timeout: 300000 }, (error: any, stdout: string, stderr: string) => {
            try { fs.unlinkSync(inputPath) } catch { /* ignore */ }
            try { fs.unlinkSync(paramsPath) } catch { /* ignore */ }

          if (error) {
            console.error('Tree segment error:', error.message)
            console.error('Tree segment stderr:', stderr)
            return res.status(500).json({ error: error.message || stderr || '单木分割执行失败' })
          }

          // Parse JSON from stderr
          let metaInfo: any = {}
          try {
            const lines = stderr.trim().split('\n').filter(l => l.trim())
            for (let i = lines.length - 1; i >= 0; i--) {
              const line = lines[i].trim()
              if (line.startsWith('{')) {
                metaInfo = JSON.parse(line)
                break
              }
            }
          } catch (e) {
            console.error('Parse tree segment meta error:', e)
          }

          // Read labels file and return as base64
          const labelsFile = metaInfo.labels_file || 'labels.bin'
          const labelsPath = path.join(segOutputDir, labelsFile)
          let labelsBase64: string | null = null
          try {
            const labelsData = fs.readFileSync(labelsPath)
            labelsBase64 = labelsData.toString('base64')
          } catch (readLabelsErr: any) {
            console.error('Read labels file error:', readLabelsErr)
          }

          const trees: any[] = metaInfo.trees || []
          
          // Cleanup
          setTimeout(() => {
            try {
              const files = fs.readdirSync(segOutputDir)
              for (const f of files) {
                try { fs.unlinkSync(path.join(segOutputDir, f)) } catch { /* ignore */ }
              }
              try { fs.rmdirSync(segOutputDir) } catch { /* ignore */ }
            } catch { /* ignore */ }
          }, 60000)

          if (trees.length === 0 && metaInfo.success) {
            return res.json({
              meta: {
                success: metaInfo.success,
                treeCount: 0,
                totalAssigned: metaInfo.total_assigned || 0,
                totalPoints: metaInfo.total_points || 0,
              },
              trees: [],
              labelsData: null,
            })
          }
          if (trees.length === 0) {
            return res.status(500).json({ error: metaInfo.error || '单木分割结果为空' })
          }

          res.json({
            meta: {
              success: metaInfo.success,
              treeCount: metaInfo.tree_count || trees.length,
              totalAssigned: metaInfo.total_assigned || 0,
              totalPoints: metaInfo.total_points || 0,
              noisePoints: metaInfo.noise_points || 0,
              params: metaInfo.params || {},
            },
            trees: trees.map((tree: any) => ({
              treeId: tree.tree_id,
              label: tree.label,
              count: tree.point_count,
              height: tree.tree_height,
              trunkHeight: tree.trunk_height,
              crownHeight: tree.crown_height,
              crownDiameter: tree.crown_diameter,
              crownRatio: tree.crown_ratio,
              location: tree.location,
              bounds: {
                xMin: tree.x_min, xMax: tree.x_max,
                yMin: tree.y_min, yMax: tree.y_max,
                zMin: tree.z_min, zMax: tree.z_max,
              },
            })),
            labelsData: labelsBase64,
          })
        })
      })
      })
    })
  } catch (error: any) {
    console.error('Tree segment request error:', error)
    res.status(500).json({ error: error.message })
  }
})

/**
 * 建筑分割接口
 * 基于平面检测与连通域分析的建筑提取算法
 */
app.post('/api/building-segment', express.raw({ limit: '200mb', type: 'application/octet-stream' }), (req, res) => {
  try {
    const buffer = req.body

    if (!buffer || buffer.length < 12) {
      return res.status(400).json({ error: '无效输入：至少需要 12 字节' })
    }

    const params: any = {}
    const paramsStr = req.headers['x-params'] as string
    if (paramsStr) {
      try {
        const parsed = JSON.parse(decodeURIComponent(paramsStr))
        Object.assign(params, parsed)
      } catch (e) { /* ignore */ }
    }

    const defaults = {
      min_building_height: 2.0,
      max_building_height: 100.0,
      min_building_area: 4.0,
      building_eps: 1.5,
      roof_flatness_threshold: 0.7,
    }
    for (const [k, v] of Object.entries(defaults)) {
      if (params[k] === undefined || params[k] === null) {
        params[k] = v
      } else {
        params[k] = Number(params[k])
      }
    }

    const timestamp = Date.now()
    const segOutputDir = path.join(outputDir, `building_seg_${timestamp}`)

    fs.mkdir(segOutputDir, { recursive: true }, (mkdirErr) => {
      if (mkdirErr) {
        return res.status(500).json({ error: mkdirErr.message })
      }

      const inputPath = path.join(segOutputDir, 'input.bin')
      const paramsPath = path.join(segOutputDir, 'params.json')
      fs.writeFile(inputPath, buffer, (writeErr) => {
        if (writeErr) {
          return res.status(500).json({ error: writeErr.message })
        }

        fs.writeFile(paramsPath, JSON.stringify(params), 'utf8', (paramsErr) => {
          if (paramsErr) {
            return res.status(500).json({ error: paramsErr.message })
          }

          execFile(pythonPath, [
            path.join(__dirname, 'building_segment.py'),
            inputPath,
            segOutputDir,
          ], { cwd: __dirname, encoding: 'utf8', maxBuffer: 100 * 1024 * 1024, timeout: 300000 }, (error: any, stdout: string, stderr: string) => {
            try { fs.unlinkSync(inputPath) } catch { /* ignore */ }
            try { fs.unlinkSync(paramsPath) } catch { /* ignore */ }

          if (error) {
            console.error('Building segment error:', error.message)
            console.error('Building segment stderr:', stderr)
            return res.status(500).json({ error: error.message || stderr || '建筑分割执行失败' })
          }

          let metaInfo: any = {}
          try {
            const lines = stderr.trim().split('\n').filter(l => l.trim())
            for (let i = lines.length - 1; i >= 0; i--) {
              const line = lines[i].trim()
              if (line.startsWith('{')) {
                metaInfo = JSON.parse(line)
                break
              }
            }
          } catch (e) {
            console.error('Parse building segment meta error:', e)
          }

          const buildings: any[] = metaInfo.buildings || []
          if (buildings.length === 0 && metaInfo.success) {
            return res.json({
              meta: {
                success: metaInfo.success,
                buildingCount: 0,
                totalAssigned: metaInfo.total_assigned || 0,
              },
              buildings: [],
            })
          }
          if (buildings.length === 0) {
            return res.status(500).json({ error: metaInfo.error || '建筑分割结果为空' })
          }

          const results = buildings.map((b: any) => {
            const bPath = path.join(segOutputDir, b.file)
            try {
              const data = fs.readFileSync(bPath)
              return {
                buildingId: b.building_id,
                label: b.label,
                count: b.point_count,
                width: b.width,
                depth: b.depth,
                height: b.height,
                area: b.area,
                volume: b.volume,
                aspectRatio: b.aspect_ratio,
                roofPlanarity: b.roof_planarity,
                bounds: {
                  xMin: b.x_min, xMax: b.x_max,
                  yMin: b.y_min, yMax: b.y_max,
                  zMin: b.z_min, zMax: b.z_max,
                },
                data: data.toString('base64'),
              }
            } catch (readErr: any) {
              return null
            }
          }).filter(Boolean)

          setTimeout(() => {
            try {
              const files = fs.readdirSync(segOutputDir)
              for (const f of files) {
                try { fs.unlinkSync(path.join(segOutputDir, f)) } catch { /* ignore */ }
              }
              try { fs.rmdirSync(segOutputDir) } catch { /* ignore */ }
            } catch { /* ignore */ }
          }, 60000)

          res.json({
            meta: {
              success: metaInfo.success,
              buildingCount: metaInfo.building_count || buildings.length,
              totalAssigned: metaInfo.total_assigned || 0,
              totalPoints: metaInfo.total_points || 0,
              unassignedPoints: metaInfo.unassigned_points || 0,
              params: metaInfo.params || {},
            },
            buildings: results,
          })
        })
      })
      })
    })
  } catch (error: any) {
    console.error('Building segment request error:', error)
    res.status(500).json({ error: error.message })
  }
})

/**
 * RandLA-Net 深度学习分类接口
 * 使用 RandLA-Net 模型进行点云语义分割
 */
app.post('/api/classify-dl', express.raw({ limit: '200mb', type: 'application/octet-stream' }), (req, res) => {
  try {
    const buffer = req.body

    if (!buffer || buffer.length < 12) {
      return res.status(400).json({ error: '无效输入：至少需要 12 字节（1 个点 × 3 个浮点数）' })
    }

    // 获取参数
    const voxelSize = parseFloat(req.headers['x-voxel-size'] as string) || 0.05
    const device = (req.headers['x-device'] as string) || 'auto'
    const modelPath = req.headers['x-model-path'] as string || undefined
    const timestamp = Date.now()
    const clsOutputDir = path.join(outputDir, `randla_classify_${timestamp}`)

    fs.mkdir(clsOutputDir, { recursive: true }, (mkdirErr) => {
      if (mkdirErr) {
        console.error('RandLA Classify mkdir error:', mkdirErr)
        return res.status(500).json({ error: mkdirErr.message })
      }

      const inputPath = path.join(clsOutputDir, 'input.bin')
      fs.writeFile(inputPath, buffer, (writeErr) => {
        if (writeErr) {
          console.error('RandLA Classify write error:', writeErr)
          return res.status(500).json({ error: writeErr.message })
        }

        // 构建命令参数
        const args = [
          path.join(__dirname, 'randla_infer.py'),
          inputPath,
          clsOutputDir,
          '--voxel-size', voxelSize.toString(),
          '--device', device,
          '--batch-size', '4096',
        ]
        
        if (modelPath) {
          args.push('--model-path', modelPath)
        }

        console.log(`🔬 RandLA-Net 分类启动: voxel=${voxelSize}, device=${device}`, new Date().toISOString())

        execFile(pythonPath, args, { 
          cwd: __dirname, 
          encoding: 'utf8', 
          maxBuffer: 200 * 1024 * 1024, 
          timeout: 600000  // 10 分钟超时
        }, (error: any, stdout: string, stderr: string) => {
          try { fs.unlinkSync(inputPath) } catch { /* ignore */ }

          if (error) {
            console.error('RandLA Classification exec error:', error.message)
            console.error('RandLA Classification stderr:', stderr)
            return res.status(500).json({ error: error.message || stderr || 'RandLA-Net 分类执行失败' })
          }

          // 解析输出 JSON
          try {
            const result = JSON.parse(stdout.trim())
            
            if (!result.success) {
              return res.status(500).json({ error: result.error || '分类失败' })
            }

            const instances: any[] = result.instances || []
            
            // 读取每个实例文件，返回 base64 数据
            const results = instances.map((inst: any) => {
              const filePath = path.join(clsOutputDir, inst.file)
              try {
                const data = fs.readFileSync(filePath)
                return {
                  category: inst.category,
                  categoryLabel: inst.category_label || inst.category,
                  instanceId: inst.instance_id,
                  label: inst.label,
                  count: inst.count,
                  zMin: inst.z_min,
                  zMax: inst.z_max,
                  zMean: inst.z_mean,
                  data: data.toString('base64'),
                }
              } catch (readErr: any) {
                console.error(`Read ${inst.file} error:`, readErr)
                return null
              }
            }).filter(Boolean)

            // 异步清理输出目录（60 秒后）
            setTimeout(() => {
              try { fs.rmSync(clsOutputDir, { recursive: true }) } catch { /* ignore */ }
            }, 60000)

            console.log(`✅ RandLA-Net 分类完成: ${results.length} 个实例`, new Date().toISOString())

            res.json({
              meta: {
                totalPoints: result.total_points,
                totalInstances: result.instance_count,
                classifiedPoints: result.classified_count,
                method: 'randla_net',
              },
              results,
            })
          } catch (parseErr: any) {
            console.error('Parse RandLA output error:', parseErr)
            console.error('stdout:', stdout?.substring(0, 500))
            return res.status(500).json({ error: '解析分类结果失败' })
          }
        })
      })
    })
  } catch (error: any) {
    console.error('RandLA Classify request error:', error)
    res.status(500).json({ error: error.message })
  }
})

// 启动前检查 Python 环境（非阻塞）
function checkPythonEnvironment(): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(pythonPath, ['--version'], (error, stdout) => {
      if (error) {
        console.error('⚠️  Python 环境检查失败:', error.message)
        resolve(false)
        return
      }

      console.log(` Python 版本: ${stdout.trim()}`)

      // 并行检查所有模块
      const modules = ['laspy', 'open3d', 'numpy']
      let loaded = 0
      const needCount = modules.length

      modules.forEach(mod => {
        execFile(pythonPath, ['-c', `import ${mod}; print("ok")`], (modErr) => {
          if (modErr) {
            console.log(`⚠️  ${mod} 未安装 (功能可能受限)`)
          } else {
            console.log(`✓ ${mod} 已安装`)
          }
          loaded++
          if (loaded === needCount) {
            resolve(true)
          }
        })
      })
    })
  })
}

// 启动服务器
function startServer() {
  // 并行启动：不等检查完成
  checkPythonEnvironment()

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 服务已启动: http://0.0.0.0:${PORT}`)
    console.log(`📡 LAS头信息: POST /api/las-header`)
    console.log(`🔍 LAS字段解析: POST /api/las-parse`)
    console.log(`📤 BIN格式解析: POST /api/bin-parse`)
    console.log(`💾 LAS导出: POST /api/las-export`)
    console.log(`🔧 滤波接口: POST /api/filter`)
    console.log(`🗂️ 分离滤波: POST /api/filter-separate`)
    console.log(`📈 高度归一化: POST /api/height-normalize`)
    console.log(`🏥 健康检查: GET http://localhost:${PORT}/api/health`)
    console.log(`🐍 Python检查: GET http://localhost:${PORT}/api/check-python`)
  })
}

startServer()
