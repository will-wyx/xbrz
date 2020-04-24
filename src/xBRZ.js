const redMask = 0xff0000;
const greenMask = 0x00ff00;
const blueMask = 0x0000ff;

class IntPtr {
    constructor(intArray) {
        this.arr = intArray;
        this.ptr = 0;
    }

    position(pos) {
        this.ptr = pos;
    }

    get() {
        return this.arr[this.ptr];
    }

    set(val) {
        this.arr[this.ptr] = val;
    }
}

class BlendResult {
    constructor() {
        this.f = 0;
        this.g = 0;
        this.j = 0;
        this.k = 0;
    }

    reset() {
        this.f = 0;
        this.g = 0;
        this.j = 0;
        this.k = 0;
    }
}

class Rot {
    constructor() {
        /*
        |0|6|8|2|1|3|
        |7|5|2|0|6|8|
        |3|8|5|1|4|4|
        |4|4|5|1|3|7|
        |6|8|2|0|7|5|
        |1|3|8|2|0|7|
         */
        this.arr = []
    }

    init() {
        const
            a = 0, b = 1, c = 2,
            d = 3, e = 4, f = 5,
            g = 6, h = 7, i = 8;

        const deg0 = [
            a, b, c,
            d, e, f,
            g, h, i
        ];

        const deg90 = [
            g, d, a,
            h, e, b,
            i, f, c
        ];

        const deg180 = [
            i, h, g,
            f, e, d,
            c, b, a
        ];

        const deg270 = [
            c, f, i,
            b, e, h,
            a, d, g
        ];

        const rotation = [
            deg0, deg90, deg180, deg270
        ];

        for (let rotDeg = 0; rotDeg < 4; rotDeg++)
            for (let x = 0; x < 9; x++)
                this.arr[(x << 2) + rotDeg] = rotation[rotDeg][x];
    }
}

const blendResult = new BlendResult();

function square(value) {
    return value * value;
}

// 用指定颜色填充区块
function fillBlock(trg, trgi, pitch, col, blockSize) {
    for (let y = 0; y < blockSize; ++y, trgi += pitch)
        for (let x = 0; x < blockSize; ++x)
            trg[trgi + x] = col
}

function distYCbCr(pix1, pix2, lumaWeight) {
    const r_diff = ((pix1 & redMask) - (pix2 & redMask)) >> 16;
    const g_diff = ((pix1 & greenMask) - (pix2 & greenMask)) >> 8;
    const b_diff = ((pix1 & blueMask) - (pix2 & blueMask));

    const k_b = 0.0722, k_r = 0.2126, k_g = 1 - k_b - k_r;
    const scale_b = 0.5 / (1 - k_b), scale_r = 0.5 / (1 - k_r);

    const y = k_r * r_diff + k_g * g_diff + k_b * b_diff;
    const c_b = scale_b * (b_diff - y);
    const c_r = scale_r * (r_diff - y);
    return square(lumaWeight * y) + square(c_b) + square(c_r);
}

function colorDist(pix1, pix2, luminanceWeight) {
    if (pix1 === pix2)
        return 0;
    return distYCbCr(pix1, pix2, luminanceWeight);
}

let config = {
    dominantDirectionThreshold: 3.6
};

function colorDist_(pix1, pix2) {
    return colorDist(pix1, pix2, config.dominantDirectionThreshold)
}

function blendComponent(mask, n, m, inPixel, setPixel) {
    const inChan = inPixel & mask;
    const setChan = setPixel & mask;
    const blend = setChan * n + inChan * (m - n);
    return mask & (blend / m);
}

function alphaBlend(n, m, dstPtr, col) {
    // assert n < 256 : "possible overflow of (col & redMask) * N";
    // assert m < 256 : "possible overflow of (col & redMask) * N + (dst & redMask) * (M - N)";
    // assert 0 < n && n < m : "0 < N && N < M";

    const dst = dstPtr.get();
    const redComponent = blendComponent(redMask, n, m, dst, col);
    const greenComponent = blendComponent(greenMask, n, m, dst, col);
    const blueComponent = blendComponent(blueMask, n, m, dst, col);
    const blend = (redComponent | greenComponent | blueComponent);
    dstPtr.set(blend | 0xff000000);
}

function buildMatrixRotation(rotDeg, I, J, N) {
    let I_old = 0, J_old = 0;
    if (rotDeg === 0) {
        I_old = I;
        J_old = J;
    } else {
        const old = buildMatrixRotation(rotDeg - 1, I, J, N);
        I_old = N - 1 - old.J;
        J_old = old.I;
    }
    return {I: I_old, J: J_old}
}

function preProcessCorners(ker4x4) {
    blendResult.reset();
    if ((ker4x4.f === ker4x4.g && ker4x4.j === ker4x4.k) ||
        (ker4x4.f === ker4x4.j && ker4x4.g === ker4x4.k))
        return;

    const weight = 4;
    const jg =
        colorDist_(ker4x4.i, ker4x4.f) +
        colorDist_(ker4x4.f, ker4x4.c) +
        colorDist_(ker4x4.n, ker4x4.k) +
        colorDist_(ker4x4.k, ker4x4.h) +
        weight * colorDist_(ker4x4.j, ker4x4.g);
    const fk =
        colorDist_(ker4x4.e, ker4x4.j) +
        colorDist_(ker4x4.j, ker4x4.o) +
        colorDist_(ker4x4.b, ker4x4.g) +
        colorDist_(ker4x4.g, ker4x4.l) +
        weight * colorDist_(ker4x4.f, ker4x4.k);

    if (jg < fk) {
        const dominantGradient = config.dominantDirectionThreshold * jg < fk;
        if (ker4x4.f !== ker4x4.g && ker4x4.f !== ker4x4.j)
            blendResult.f = dominantGradient ? 'BLEND_DOMINANT' : 'BLEND_NORMAL';
        if (ker4x4.k !== ker4x4.g && ker4x4.k !== ker4x4.j)
            blendResult.k = dominantGradient ? 'BLEND_DOMINANT' : 'BLEND_NORMAL';
    } else if (fk < jg) {
        const dominantGradient = config.dominantDirectionThreshold * fk < jg;
        if (ker4x4.j !== ker4x4.f && ker4x4.j !== ker4x4.k)
            blendResult.j = dominantGradient ? 'BLEND_DOMINANT' : 'BLEND_NORMAL';
        if (ker4x4.g !== ker4x4.f && ker4x4.g !== ker4x4.k)
            blendResult.g = dominantGradient ? 'BLEND_DOMINANT' : 'BLEND_NORMAL';
    }
}

export function scaleImage() {
    console.log('placeholder')
}

