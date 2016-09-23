// Sopa.js version 1.1
// JavaScript source code for reproducing a SOPA file
// Created by Kaoru Ashihara
/*
The MIT License (MIT)

Copyright (c) 2016 AIST

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/

Sopa = function (url) {
    this.urlStr = url;  // Location of a SOPA file
    var ua = navigator.userAgent.toLowerCase();
    var isPlaying = false;
    var isDatabaseReady = false;
    var isIphone = false;
    var isMobile = false;
    var isLastLoop = false;
    var noError = true;
    var cardioid = 0;   // Directionality Omini;0, Cardioid;1, Cardioid^2;2
    var hrtfStr;    // for the location of HRTF level database file (hrtf3d512.bin)
    var phaseStr;   // for the location of HRTF phase database file (phase3d512.bin)
    var hrtfHttp = new XMLHttpRequest();
    var phaseHttp = new XMLHttpRequest();
    var hrtf_buffer = new Int16Array(130048);   // Array for the HRTF level data
    var phase_buffer = new Int16Array(130048);  // Array for the HRTF phase data
    var sopaArray0, sopaArray1;  // Array for the directional parameters
    var pcmArray0, pcmArray1;   // Array for the PCM data stream
    var header;     // Header of the SOPA file
    var loadNum = 0;
    var playNum;
    var sopaSampleRate = 0;
    var sopaVersion;
    var bufsize = 0;    // Size of AudioContext buffer
    var currentOffset = 0;
    var datanum = 0;
    var originum = 0;
    var processed;
    var sDataL;
    var sDataR;
    var AudioContext;
    var audiocontext;
    var scrproc;
    var sampleRate;     // Sampling rate of the audio device
    var ratio;
    var fftSize = 0;    // FFT window size
    var horizontalAngle = 36;   // Parameter for pan (from 0 to 71)
    var verticalAngle = 18;     // parameter for tilt (from 0 to 35)
    var dHann;          // for window function
    var dirArray = new Array(256);
    var coordVect = new Array();
    var vecFocus = [0, 0, 1];    // Coordinates of the focus direction
    var progress = 0;
    var lStock = new Float32Array(2229);
    var rStock = new Float32Array(2229);

    this.setup = function () {
        var nTilt, nPan;

        if (ua.indexOf('iphone') > -1 || ua.indexOf('ipod') > -1 || ua.indexOf('ipad') > -1) {
            isIphone = true;
            isMobile = true;
        }
        else if (ua.indexOf('android') > -1)
            isMobile = true;

        try {
            AudioContext = window.AudioContext || window.webkitAudioContext;
            audiocontext = new AudioContext();
        }
        catch (e) {
            alert("Web Audio API is not supported in this browser")
            return (false);
        }

        sampleRate = audiocontext.sampleRate;
        //        console.log("SampleRate " + sampleRate);
        if (sopaSampleRate == 0) {
            alert("SOPA data not available!");
            return (false);
        }
        ratio = sampleRate / sopaSampleRate;
        horizontalAngle = 36;       // Initial value of pan
        verticalAngle = 18;         // Initial value of tilt
        bufsize = 4096;             // Size of audiocontext buffer
        playNum = 0;

        // Prepare window function ****************
        dHann = new Float32Array(fftSize);  // Array for the window function
        var dRamp = fftSize / 8;
        for (var iInt = 0; iInt < fftSize; iInt++) {
            if (iInt < dRamp) {
                dHann[iInt] = (1 - Math.cos(Math.PI * iInt / dRamp)) / 4;
            }
            else if (iInt >= fftSize - dRamp) {
                dHann[iInt] = (1 - Math.cos(Math.PI * (fftSize - iInt) / dRamp)) / 4;
            }
            else {
                dHann[iInt] = 1 / 2;
            }
        }
        // Prepare coordinates vectors ****************
        for (var iSectNum = 0; iSectNum < 254; iSectNum++) {
            coordVect[iSectNum] = this.initCoord(iSectNum);
        }
        for (var iSect = 0; iSect < 256; iSect++) {
            dirArray[iSect] = new Array(72);
            for (var iPan = 0; iPan < 72; iPan++) {
                dirArray[iSect][iPan] = new Array(36);
                if (iPan >= 36)
                    nPan = -Math.PI * (72 - iPan) / 36;
                else
                    nPan = Math.PI * iPan / 36;
                for (var iTilt = -18; iTilt < 18; iTilt++) {
                    nTilt = Math.PI * iTilt / 36;
                    var iVar = this.modifySector(iSect, nPan, nTilt);
                    dirArray[iSect][iPan][iTilt + 18] = parseInt(iVar);
                    //                    if(iSect == 138 && iTilt == 0)
                    //                        console.log(iSect + " " + iPan + " " + parseInt(iVar));
                }
            }
        }
        scrproc = audiocontext.createScriptProcessor(bufsize, 2, 2);
        return (true);
    }

    /*
    /   Database preparation
    */
    this.loadDatabase = function (hrtf, phase) {
        hrtfStr = hrtf;
        phaseStr = phase;
        hrtfHttp.open("GET", hrtfStr, true);
        hrtfHttp.responseType = "arraybuffer";
        hrtfHttp.onreadystatechange = this.handleHrtf;
        hrtfHttp.send(null);
        phaseHttp.open("GET", phaseStr, true);
        phaseHttp.responseType = "arraybuffer";
        phaseHttp.onreadystatechange = this.handlePhase;
        phaseHttp.send(null);
    }

    Sopa.prototype.handleHrtf = function () {
        var that = this;
        if (hrtfHttp.readyState == 4 && hrtfHttp.status == 200) {
            hrtf_buffer = new Int16Array(hrtfHttp.response); // HRTF (amplitude) data
            //            console.log("Hrtf data loaded " + hrtf_buffer.byteLength);
            progress++;
            if (progress > 1)
                isDatabaseReady = true;
        }
    };

    Sopa.prototype.handlePhase = function () {
        var that = this;
        if (phaseHttp.readyState == 4 && phaseHttp.status == 200) {
            phase_buffer = new Int16Array(phaseHttp.response); // HRTF (phase) data
            //            console.log("Phase data loaded " + phase_buffer.byteLength);
            progress++;
            if (progress > 1)
                isDatabaseReady = true;
        }
    };

    /**
    /   Method to load SOPA data
    */
    this.loadSopaData = function () {
        this.loadSopa(this.handleSopa);
    };

    Sopa.prototype.loadSopa = function (back) {
        var _this = this;
        var sopaHttp = new XMLHttpRequest();
        //        console.log("Loading SOPA file " + this.urlStr);
        sopaHttp.open("GET", this.urlStr, true);
        sopaHttp.responseType = "arraybuffer";
        sopaHttp.onreadystatechange = function () {
            if (sopaHttp.readyState != 4)
                return;
            if (sopaHttp.status != 200 && sopaHttp.readyState == 4) {
                alert('HTTP error ' + sopaHttp.status);
                return;
            }
            back.call(_this, sopaHttp);
        };
        sopaHttp.send(null);
    };

    Sopa.prototype.handleSopa = function (req) {
        var that = this;
        var sopa_buffer = req.response;
        var dataview = new DataView(sopa_buffer);
        var sampleNum = (dataview.byteLength - 44) / 4;
        header = new Uint8Array(sopa_buffer, 0, 44);                            // Header of the SOPA file
        if (loadNum == 0) {
            sopaArray0 = new Uint8Array(sopa_buffer, 44, sampleNum * 4);              // Directional data array
            pcmArray0 = new Int16Array(sopa_buffer, 44, sampleNum * 2);                   // PCM data array
        }
        else {
            sopaArray1 = new Uint8Array(sopa_buffer, 44, sampleNum * 4);              // Directional data array
            pcmArray1 = new Int16Array(sopa_buffer, 44, sampleNum * 2);                   // PCM data array
        }

        //        console.log("Number of samples " + pcmArray0.length);
        if (originum == 0) {
            if (!that.checkHeader())
                noError = false;
            else
                noError = true;
        }
        if (loadNum == 0)
            loadNum = 1;
        else
            loadNum = 0;
    };

    Sopa.prototype.checkHeader = function () {
        var compU = new Uint8Array(4);
        var chunkSize;

        for (i = 8; i < 12; i++) {
            compU[i - 8] = header[i];
        }
        if (compU[0] != 83 || compU[1] != 79 || compU[2] != 80 || compU[3] != 65) {
            alert("Data format error!");
            return (false);
        }

        for (i = 12; i < 15; i++) {
            compU[i - 12] = header[i];
        }
        if (compU[0] != 102 || compU[1] != 109 || compU[2] != 116) {
            alert("Data format error!");
            return (false);
        }

        if (header[16] != 16) {
            alert("PCM data should be 16-bit depth!");
            return (false);
        }

        sopaSampleRate = header[25] & 0x000000ff;
        sopaSampleRate *= 256;
        sopaSampleRate += header[24] & 0xff;
        if (sopaSampleRate != 22050 && sopaSampleRate != 44100) {
            alert("Wrong sampleRate! " + sopaSampleRate);
            return (false);
        }

        //        console.log("Version " + header[39] + "." + header[38] + "." + header[37]);
        sopaVersion = header[39];
        if (sopaVersion < 2) {
            alert("Sorry, this version is not supported");
            return (false);
        }

        chunkSize = header[43] & 0x000000ff;
        chunkSize *= 16777216;
        var lLong = header[42] & 0x000000ff;
        lLong *= 65536;
        chunkSize += lLong;
        lLong = header[41] & 0x000000ff;
        lLong *= 256;
        chunkSize += lLong;
        chunkSize += header[40];

        //        return (false);
        if (fftSize == 0) {
            var i = 5;
            while (sopaArray0[i] != 255 && i <= 4096)
                i += 4;
            fftSize = i - 1;                // FFT size
            if (fftSize > 4096) {
                alert("Something wrong!");
                return (false);
            }
            //            console.log("FFT size " + fftSize);
            sDataL = new Float32Array(fftSize);
            sDataR = new Float32Array(fftSize);
        }

        return (true);
    };

    this.fftWinSize = function () {
        if (noError)
            return fftSize;
        else
            return (0);
    }

    this.databaseReady = function () {
        return isDatabaseReady;
    }

    this.beingPlayed = function () {
        return isPlaying;
    }

    /*
    /   Method to start and stop reproduction
    */
    this.Play = function () {
        this.play();
    }

    /*
    /   Getter of currentOffset
    */
    this.currentOffset = function () {
        return currentOffset;
    }

    /*
    /   Getter of total samples played
    */
    this.totalOffset = function () {
        return originum;
    }

    /*
    /   Getter of sample rate
    */
    this.getSampleRate = function () {
        return sopaSampleRate;
    }

    /*
    /   Setter of isLastLoop
    */
    this.setLastLoop = function (isThis) {
        isLastLoop = isThis;
    }

    /*
    /   Setter of the URL of SOPA file
    */
    this.setUrl = function (url) {
        this.urlStr = url;
    }

    /*
    /   Setter of the pan variable
    */
    this.setPan = function (deg) {
        if (deg > 179)
            deg = 179;
        else if (deg < -180)
            deg = -180;
        horizontalAngle = Math.floor(36 + deg / 5);
    }

    /*
    /   Setter of the tilt variable
    */
    this.setTilt = function (deg) {
        if (deg > 89)
            deg = 89;
        else if (deg < -90)
            deg = -90;
        verticalAngle = Math.floor(18 + deg / 5);
    }

    /*
    /   Setter of directionality
    */
    this.setCardioid = function (card, focusHor, focusVer) {
        var forcus;
        cardioid = card;

        if (focusHor == undefined)
            focus = Math.PI;
        else
            focus = focusHor + Math.PI;
        if (focusVer == undefined)
            focusVer = 0;

        vecFocus[0] = Math.sin(focus);
        vecFocus[1] = Math.sin(focusVer);
        vecFocus[2] = Math.cos(focus);
    }

    Sopa.prototype.play = function () {
        var _this = this;

        if (!isPlaying) {
            originum = 0;
            datanum = 0;
            currentOffset = 0;
            currenttime = 0;
            playNum = 0;
            processed = 0;

            /* for iPhone, iPod touch and iPad
            if (isIphone) {
                var dummy = audiocontext.createBufferSource();
                dummy.start(0);
                dummy.connect(scrproc);
            }   */

            scrproc.onaudioprocess = function (audioProcessingEvent) {
                _this.Process.call(_this, audioProcessingEvent);
            };
            if (isIphone)
                audiocontext.createBufferSource().start(0);

            // Start reproduction
            isPlaying = true;
            scrproc.connect(audiocontext.destination);
        }
        else {
            // Stop reproduction
            scrproc.disconnect(audiocontext.destination);
            scrproc.onaudioprocess = null;
            isPlaying = false;
        }
    };

    /*
    /   Callback loop
    */
    Sopa.prototype.Process = function (event) {
        var _this = this;
        var iSize = fftSize;
        var wSize = fftSize * 2;
        var proc = iSize / 2;
        var Nyq = iSize / 2;
        var sPeriod = 1 / sampleRate;
        var dir;
        var dirsec;
        var dil;
        var dilsec;
        var iMirror;
        var iRatio = (44100 * iSize) / (sopaSampleRate * 512);
        var iFreq;
        var iImg;
        var dSpR;
        var dSpL;
        var dSpImageR;
        var dSpImageL;
        var dPhaseR;
        var dPhaseL;
        var dPhaseImageR;
        var dPhaseImageL;
        var dWeight_a = 1;
        var dWeight_b = 1;
        var iNumber;
        var iSecond;
        var iNumImage;
        var iSecondImage;
        var iBin;
        var nAtt = 2048.0;
        var dReR = new Float32Array(iSize);
        var dReL = new Float32Array(iSize);
        var dImR = new Float32Array(iSize);
        var dImL = new Float32Array(iSize);
        var buf0 = event.outputBuffer.getChannelData(0);
        var buf1 = event.outputBuffer.getChannelData(1);
        var stock = processed - datanum;
        var sub = lStock.subarray(0, stock);
        var pcmsub, pcmnew, pcmadd, pcmtarg;
        var currSample;

        buf0.set(sub, 0);
        sub = rStock.subarray(0, stock);
        buf1.set(sub, 0);
        datanum += stock;
        currenttime = datanum / sampleRate;
        var frames = Math.ceil((bufsize - stock) / (ratio * proc));
        var count = stock;
        for (var frm = 0; frm < frames; frm++) {
            currSample = currentOffset * 2;
            if (playNum == 0) {
                if (currSample + wSize > pcmArray0.length) {
                    pcmtarg = pcmArray0.subarray(currSample, pcmArray0.length);
                    if (pcmArray1 != null)
                        pcmadd = pcmArray1.subarray(0, currSample + wSize - pcmArray0.length);
                    else
                        pcmadd = pcmArray0.subarray(0, currSample + wSize - pcmArray0.length);
                    pcmnew = new Int16Array(pcmtarg.length + pcmadd.length);
                    pcmnew.set(pcmtarg);
                    pcmnew.set(pcmadd, pcmtarg.length);
                }
                else
                    pcmnew = pcmArray0.subarray(currSample, currSample + wSize);
            }
            else {
                if (currSample + wSize > pcmArray1.length) {
                    pcmtarg = pcmArray1.subarray(currSample, pcmArray1.length);
                    pcmadd = pcmArray0.subarray(0, currSample + wSize - pcmArray1.length);
                    pcmnew = new Int16Array(pcmtarg.length + pcmadd.length);
                    pcmnew.set(pcmtarg);
                    pcmnew.set(pcmadd, pcmtarg.length);
                }
                else
                    pcmnew = pcmArray1.subarray(currSample, currSample + wSize);
            }
            var pcm = new Float32Array(fftSize);
            var image = new Float32Array(fftSize);
            for (iBin = 0; iBin < fftSize; iBin++)
                pcm[iBin] = pcmnew[iBin * 2 + 1];
            //            pcm.set(pcmnew, 0);
            var newObj = { "real": pcm, "image": image };
            this.fastFt(newObj, false);
            var address = currSample * 2;
            var addNyq = address + iSize;
            dReL[Nyq] = pcm[Nyq] * Math.cos(image[Nyq]);
            dReR[Nyq] = pcm[Nyq] * Math.cos(image[Nyq]);
            dImL[Nyq] = pcm[Nyq] * Math.sin(image[Nyq]);
            dImR[Nyq] = pcm[Nyq] * Math.sin(image[Nyq]);
            for (iBin = 0; iBin < Nyq; iBin++) {
                iMirror = iSize - iBin;
                iFreq = parseInt(iBin / iRatio);
                if (iFreq == 0)
                    iImg = iFreq;
                else
                    iImg = 511 - iFreq;
                if (playNum == 0) {
                    if (iBin % 2 == 0)
                        dir = sopaArray0[address + iBin * 2 + 1];
                    else
                        dir = sopaArray0[address + (iBin - 1) * 2];
                }
                else {
                    if (iBin % 2 == 0)
                        dir = sopaArray1[address + iBin * 2 + 1];
                    else
                        dir = sopaArray1[address + (iBin - 1) * 2];
                }
                if (sopaVersion > 2) {
                    if (playNum == 0) {
                        if (iBin % 2 == 0)
                            dirsec = sopaArray0[addNyq + iBin * 2 + 1];
                        else
                            dirsec = sopaArray0[addNyq + (iBin - 1) * 2];
                    }
                    else {
                        if (iBin % 2 == 0)
                            dirsec = sopaArray1[addNyq + iBin * 2 + 1];
                        else
                            dirsec = sopaArray1[addNyq + (iBin - 1) * 2];
                    }
                }
                else
                    dirsec = dir;
                if (iFreq == 0) {
                    dSpR = dSpL = pcm[iBin];
                    dPhaseL = dPhaseR = image[iBin];
                    if (iBin > 0) {
                        dSpImageL = dSpImageR = pcm[iMirror];
                        dPhaseImageL = dPhaseImageR = image[iMirror];
                    }
                }
                else if (dir >= 254 && dirsec >= 254) {
                    dSpR = dSpL = pcm[iBin];
                    dPhaseL = dPhaseR = image[iBin];
                    dSpImageL = dSpImageR = pcm[iMirror];
                    dPhaseImageL = dPhaseImageR = image[iMirror];
                }
                else {
                    if (dir > 253)
                        dir = dirsec;
                    else if (dirsec > 253)
                        dirsec = dir;
                    dil = this.opposit(dir);
                    dir = dirArray[dir][horizontalAngle][verticalAngle];
                    dilsec = this.opposit(dirsec);
                    dirsec = dirArray[dirsec][horizontalAngle][verticalAngle];
                    if (cardioid > 0) {
                        var coord = this.initCoord(dir);
                        dWeight_a = this.polar(vecFocus, coord);
                        coord = this.initCoord(dirsec);
                        dWeight_b = this.polar(vecFocus, coord);
                        if (cardioid == 2) {
                            dWeight_a *= dWeight_a;
                            dWeight_b *= dWeight_b;
                        }
                    }
                    if (horizontalAngle == 0) {
                        dil = dirArray[dil][horizontalAngle][verticalAngle];
                    }
                    else {
                        dil = dirArray[dil][72 - horizontalAngle][verticalAngle];
                    }
                    if (horizontalAngle == 0)
                        dilsec = dirArray[dilsec][horizontalAngle][verticalAngle];
                    else
                        dilsec = dirArray[dilsec][72 - horizontalAngle][verticalAngle];
                    iNumber = 512 * dir + iFreq;
                    iNumImage = 512 * dir + iImg;
                    var nPwr = hrtf_buffer[iNumber] * dWeight_a / nAtt;
                    iSecond = 512 * dirsec + iFreq;
                    iSecondImage = 512 * dirsec + iImg;
                    nPwr += hrtf_buffer[iSecond] * dWeight_b / nAtt;
                    nPwr /= 2;
                    var nPhase = phase_buffer[iNumber] / 10000.0;
                    nPhase += phase_buffer[iSecond] / 10000.0;
                    nPhase /= 2.0;
                    if (Math.abs(phase_buffer[iNumber] - phase_buffer[iSecond]) > 31415) {
                        if (nPhase < 0)
                            nPhase += Math.PI;
                        else
                            nPhase -= Math.PI;
                    }
                    dSpR = pcm[iBin] * nPwr;
                    dPhaseR = image[iBin] + nPhase;
                    nPwr = hrtf_buffer[iNumImage] * dWeight_a / nAtt;
                    nPwr += hrtf_buffer[iSecondImage] * dWeight_b / nAtt;
                    nPwr /= 2;
                    dSpImageR = pcm[iMirror] * nPwr;
                    nPhase = phase_buffer[iNumImage] / 10000.0;
                    nPhase += phase_buffer[iSecondImage] / 10000.0;
                    nPhase /= 2.0;
                    dPhaseImageR = image[iMirror] + nPhase;
                    iNumber = 512 * dil + iFreq;
                    iNumImage = 512 * dil + iImg;
                    nPwr = hrtf_buffer[iNumber] * dWeight_a / nAtt;
                    iSecond = 512 * dilsec + iFreq;
                    iSecondImage = 512 * dilsec + iImg;
                    nPwr += hrtf_buffer[iSecond] * dWeight_b / nAtt;
                    nPwr /= 2;
                    nPhase = phase_buffer[iNumber] / 10000.0;
                    nPhase += phase_buffer[iSecond] / 10000.0;
                    nPhase /= 2.0;
                    if (Math.abs(phase_buffer[iNumber] - phase_buffer[iSecond]) > 31415) {
                        if (nPhase < 0)
                            nPhase += Math.PI;
                        else
                            nPhase -= Math.PI;
                    }
                    dSpL = pcm[iBin] * nPwr;
                    dPhaseL = image[iBin] + nPhase;
                    nPwr = hrtf_buffer[iNumImage] * dWeight_a / nAtt;
                    nPwr += hrtf_buffer[iSecondImage] * dWeight_b / nAtt;
                    nPwr /= 2;
                    dSpImageL = pcm[iMirror] * nPwr;
                    nPhase = phase_buffer[iNumImage] / 10000.0;
                    nPhase += phase_buffer[iSecondImage] / 10000.0;
                    nPhase /= 2.0;
                    dPhaseImageL = image[iMirror] + nPhase;
                }
                dReL[iBin] = dSpL * Math.cos(dPhaseL);
                dReR[iBin] = dSpR * Math.cos(dPhaseR);
                dImL[iBin] = dSpL * Math.sin(dPhaseL);
                dImR[iBin] = dSpR * Math.sin(dPhaseR);
                if (iBin > 0) {
                    dReL[iMirror] = dSpImageL * Math.cos(dPhaseImageL);
                    dReR[iMirror] = dSpImageR * Math.cos(dPhaseImageR);
                    dImL[iMirror] = dSpImageL * Math.sin(dPhaseImageL);
                    dImR[iMirror] = dSpImageR * Math.sin(dPhaseImageR);
                }
            }
            newObj = { "real": dReL, "image": dImL };
            this.fastFt(newObj, true);
            newObj = { "real": dReR, "image": dImR };
            this.fastFt(newObj, true);
            for (iBin = 0; iBin < iSize; iBin++) {
                // Hann window
                dReL[iBin] *= dHann[iBin];
                dReR[iBin] *= dHann[iBin];
                // Overlap and add
                sDataL[iBin] += dReL[iBin];
                sDataR[iBin] += dReR[iBin];
            }
            for (iBin = 0; iBin < proc; iBin++) {
                var offset = iBin * ratio;
                var newL = sDataL[iBin + 1] / 32768;
                var newR = sDataR[iBin + 1] / 32768;
                var valL = sDataL[iBin] / 32768;
                var valR = sDataR[iBin] / 32768;
                var origitime = originum / sopaSampleRate;
                while (currenttime < origitime) {
                    var prop = (origitime - currenttime) * sopaSampleRate;
                    var nowL = (valL * prop) + (newL * (1 - prop));
                    var nowR = (valR * prop) + (newR * (1 - prop));
                    if (count < bufsize) {
                        buf0[count] = nowL;
                        buf1[count] = nowR;
                        datanum++;
                        currenttime = datanum / sampleRate;
                    }
                    else {
                        lStock[count - bufsize] = nowL;
                        rStock[count - bufsize] = nowR;
                        currenttime += sPeriod;
                    }
                    count++;
                    processed++;
                }
                originum++;
            }
            pcmsub = sDataL.subarray(proc);
            sDataL = new Float32Array(fftSize);
            sDataL.set(pcmsub, 0);
            pcmsub = sDataR.subarray(proc);
            sDataR = new Float32Array(fftSize);
            sDataR.set(pcmsub, 0);
            var stream;
            if (playNum == 0)
                stream = pcmArray0.length / 2;
            else
                stream = pcmArray1.length / 2;
            if (currentOffset + proc >= stream) {
                if (!isLastLoop) {
                    currentOffset = 0;
                    if (playNum == 0 && pcmArray1)
                        playNum = 1;
                    else
                        playNum = 0;
                }
                else {
                    frm = frames;
                    _this.play();
                }
            }
            else
                currentOffset += proc;
        }
    };

    /*
    /   Fourier transform
    */
    Sopa.prototype.fastFt = function (ret, isInv) {
        var sc;
        var f;
        var c;
        var s;
        var t;
        var c1;
        var s1;
        var x1;
        var kyo1;
        var dHan;
        var dPower;
        var dPhase;
        var n;
        var j;
        var i;
        var k;
        var ns;
        var l1;
        var i0;
        var i1;
        var iInt;
        var iTap = fftSize;
        var dWpi = Math.PI * 2;
        var dData = ret["real"];
        var dImg = ret["image"];
        if (!isInv) {
            for (iInt = 0; iInt < iTap; iInt++) {
                dImg[iInt] = 0; // Imaginary part 
                dHan = (1 - Math.cos((dWpi * iInt) / iTap)) / 2; // Hanning Window 
                dData[iInt] *= dHan; // Real part 
            }
        }
        /*	printf("******************** Arranging BIT ******************\n"); */
        n = iTap; /* NUMBER of DATA */
        sc = Math.PI;
        j = 0;
        for (i = 0; i < n - 1; i++) {
            if (i <= j) {
                t = dData[i];
                dData[i] = dData[j];
                dData[j] = t;
                t = dImg[i];
                dImg[i] = dImg[j];
                dImg[j] = t;
            }
            k = n / 2;
            while (k <= j) {
                j = j - k;
                k /= 2;
            }
            j += k;
        }
        /*	printf("******************** MAIN LOOP **********************\n"); */
        ns = 1;
        if (isInv)
            f = 1.0;
        else
            f = -1.0;
        while (ns <= n / 2) {
            c1 = Math.cos(sc);
            s1 = Math.sin(f * sc);
            c = 1.0;
            s = 0.0;
            for (l1 = 0; l1 < ns; l1++) {
                for (i0 = l1; i0 < n; i0 += (2 * ns)) {
                    i1 = i0 + ns;
                    x1 = (dData[i1] * c) - (dImg[i1] * s);
                    kyo1 = (dImg[i1] * c) + (dData[i1] * s);
                    dData[i1] = dData[i0] - x1;
                    dImg[i1] = dImg[i0] - kyo1;
                    dData[i0] = dData[i0] + x1;
                    dImg[i0] = dImg[i0] + kyo1;
                }
                t = (c1 * c) - (s1 * s);
                s = (s1 * c) + (c1 * s);
                c = t;
            }
            ns *= 2;
            sc /= 2.0;
        }
        if (!isInv) {
            for (iInt = 0; iInt < iTap; iInt++) {
                dData[iInt] /= iTap;
                dImg[iInt] /= iTap;
                dPower = Math.sqrt(dData[iInt] * dData[iInt] + dImg[iInt] * dImg[iInt]);
                dPhase = Math.atan2(dImg[iInt], dData[iInt]);
                dData[iInt] = dPower;
                dImg[iInt] = dPhase;
            }
        }
    };

    /*
    /   Method returns 3D coordinates of a sector
    */
    Sopa.prototype.initCoord = function (iSector) {
        var coord = new Array(3);
        var nPan, nTilt;
        var nUnitLong;
        var nUnitHori;
        var nHoriAngl;
        var nUnitLat = Math.PI / 12;
        if (iSector >= 127)
            nUnitLat *= -1;
        if (iSector == 0) {
            coord[0] = coord[2] = 0;
            coord[1] = 1;
        }
        else if (iSector == 253) {
            coord[0] = coord[2] = 0;
            coord[1] = -1;
        }
        else if (iSector < 9 || iSector >= 245) {
            nUnitLong = Math.PI / 4.0;
            nUnitHori = Math.cos(nUnitLat * 5);
            if (iSector < 9) {
                coord[1] = Math.sin(nUnitLat * 5);
                nHoriAngl = nUnitLong * (iSector - 1) - Math.PI;
            }
            else {
                coord[1] = Math.sin(nUnitLat * -5);
                nHoriAngl = nUnitLong * (252 - iSector);
            }
            coord[0] = nUnitHori * Math.sin(nHoriAngl);
            coord[2] = nUnitHori * Math.cos(nHoriAngl);
        }
        else if (iSector < 25 || iSector >= 229) {
            nUnitLong = Math.PI / 8;
            nUnitHori = Math.cos(nUnitLat * 4);
            if (iSector < 25) {
                coord[1] = Math.sin(nUnitLat * 4);
                nHoriAngl = nUnitLong * (iSector - 9) - Math.PI;
            }
            else {
                coord[1] = Math.sin(nUnitLat * -4);
                nHoriAngl = nUnitLong * (244 - iSector);
            }
            coord[0] = nUnitHori * Math.sin(nHoriAngl);
            coord[2] = nUnitHori * Math.cos(nHoriAngl);
        }
        else if (iSector < 49 || iSector >= 205) {
            nUnitLong = Math.PI / 12;
            nUnitHori = Math.cos(nUnitLat * 3);
            if (iSector < 49) {
                coord[1] = Math.sin(nUnitLat * 3);
                nHoriAngl = nUnitLong * (iSector - 25) - Math.PI;
            }
            else {
                coord[1] = Math.sin(nUnitLat * -3);
                nHoriAngl = nUnitLong * (228 - iSector);
            }
            coord[0] = nUnitHori * Math.sin(nHoriAngl);
            coord[2] = nUnitHori * Math.cos(nHoriAngl);
        }
        else if (iSector < 79 || iSector >= 175) {
            nUnitLong = Math.PI / 15;
            nUnitHori = Math.cos(nUnitLat * 2);
            if (iSector < 79) {
                coord[1] = Math.sin(nUnitLat * 2);
                nHoriAngl = nUnitLong * (iSector - 49) - Math.PI;
            }
            else {
                coord[1] = Math.sin(nUnitLat * -2);
                nHoriAngl = nUnitLong * (204 - iSector);
            }
            coord[0] = nUnitHori * Math.sin(nHoriAngl);
            coord[2] = nUnitHori * Math.cos(nHoriAngl);
        }
        else if (iSector < 111 || iSector >= 143) {
            nUnitLong = Math.PI / 16;
            nUnitHori = Math.cos(nUnitLat);
            if (iSector < 111) {
                coord[1] = Math.sin(nUnitLat);
                nHoriAngl = nUnitLong * (iSector - 79) - Math.PI;
            }
            else {
                coord[1] = Math.sin(-nUnitLat);
                nHoriAngl = nUnitLong * (174 - iSector);
            }
            coord[0] = nUnitHori * Math.sin(nHoriAngl);
            coord[2] = nUnitHori * Math.cos(nHoriAngl);
        }
        else {
            nUnitLong = Math.PI / 16;
            nUnitHori = 1.0;
            coord[1] = 0;
            if (iSector < 127)
                nHoriAngl = nUnitLong * (iSector - 111) - Math.PI;
            else
                nHoriAngl = nUnitLong * (142 - iSector);
            coord[0] = nUnitHori * Math.sin(nHoriAngl);
            coord[2] = nUnitHori * Math.cos(nHoriAngl);
        }
        return coord;
    };

    /*
    /   Calculate the sound image direction from the left ear
    */
    Sopa.prototype.opposit = function (right) {
        if (right == 0 || right >= 253)
            return (right);
        else if (right < 9) {
            if (right == 1)
                return (right);
            else
                return (10 - right);
        }
        else if (right < 25) {
            if (right == 9)
                return (right);
            else
                return (34 - right);
        }
        else if (right < 49) {
            if (right == 25)
                return (right);
            else
                return (74 - right);
        }
        else if (right < 79) {
            if (right == 49)
                return (right);
            else
                return (128 - right);
        }
        else if (right < 111) {
            if (right == 79)
                return (right);
            else
                return (190 - right);
        }
        else if (right < 127) {
            if (right == 111)
                return (right);
            else
                return (15 + right);
        }
        else if (right < 143) {
            if (right == 142)
                return (right);
            else
                return (right - 15);
        }
        else if (right < 175) {
            if (right == 174)
                return (right);
            else
                return (316 - right);
        }
        else if (right < 205) {
            if (right == 204)
                return (right);
            else
                return (378 - right);
        }
        else if (right < 229) {
            if (right == 228)
                return (right);
            else
                return (432 - right);
        }
        else if (right < 245) {
            if (right == 244)
                return (right);
            else
                return (472 - right);
        }
        else {
            if (right == 252)
                return (right);
            else
                return (496 - right);
        }
    };

    /*
    /   Method returns a sector No. after applied pan and tilt
    */
    Sopa.prototype.modifySector = function (iSector, nPan, nTilt) {
        var iNewSect;
        var nUnitHori;
        var nHoriAngl = 0;
        if (iSector > 253)
            return iSector;
        if (iSector != 0 && iSector != 253)
            nHoriAngl = Math.atan2(coordVect[iSector][0], coordVect[iSector][2]) + nPan;
        if (iSector == 0 || iSector == 253)
            nUnitHori = 0;
        else if (iSector < 9 || iSector >= 245) {
            nUnitHori = Math.cos(Math.PI * 5 / 12);
        }
        else if (iSector < 25 || iSector >= 229) {
            nUnitHori = Math.cos(Math.PI / 3);
        }
        else if (iSector < 49 || iSector >= 205) {
            nUnitHori = Math.cos(Math.PI / 4);
        }
        else if (iSector < 79 || iSector >= 175) {
            nUnitHori = Math.cos(Math.PI / 6);
        }
        else if (iSector < 111 || iSector >= 143) {
            nUnitHori = Math.cos(Math.PI / 12);
        }
        else
            nUnitHori = 1.0;
        var myCoord = new Array();
        myCoord[0] = nUnitHori * Math.sin(nHoriAngl);
        myCoord[2] = nUnitHori * Math.cos(nHoriAngl);
        myCoord[1] = coordVect[iSector][1];
        if (nTilt == 0 || myCoord[2] == 0)
            iNewSect = this.calcSector(myCoord);
        else {
            var xV = myCoord[0];
            var yV = myCoord[1];
            var zV = myCoord[2];
            var nVerAngl = Math.atan2(yV, zV) + nTilt;
            var nUnitVer = Math.sqrt(zV * zV + yV * yV);
            myCoord[2] = nUnitVer * Math.cos(nVerAngl);
            myCoord[1] = nUnitVer * Math.sin(nVerAngl);
            iNewSect = this.calcSector(myCoord);
        }
        return iNewSect;
    };

    /*
    /   Getter of the sector number
    */
    Sopa.prototype.calcSector = function (coor) {
        var iSector;
        var nHoriAngl;
        var dWpi = Math.PI * 2;
        if (coor[1] >= Math.sin(Math.PI * 11 / 24))
            return 0;
        else if (coor[1] <= -Math.sin(Math.PI * 11 / 24))
            return 253;
        else {
            nHoriAngl = Math.atan2(coor[0], coor[2]);
        }
        if (coor[1] >= Math.sin(Math.PI * 3 / 8)) {
            if (nHoriAngl < 0)
                nHoriAngl += dWpi;
            iSector = 1 + nHoriAngl / (Math.PI / 4);
        }
        else if (coor[1] <= -Math.sin(Math.PI * 3 / 8))
            iSector = 249.0 - nHoriAngl / (Math.PI / 4);
        else if (coor[1] >= Math.sin(Math.PI * 7 / 24)) {
            if (nHoriAngl < 0)
                nHoriAngl += dWpi;
            iSector = 9.0 + nHoriAngl / (Math.PI / 8);
        }
        else if (coor[1] <= -Math.sin(Math.PI * 7 / 24))
            iSector = 237.0 - nHoriAngl / (Math.PI / 8);
        else if (coor[1] >= Math.sin(Math.PI * 5 / 24)) {
            if (nHoriAngl < 0)
                nHoriAngl += dWpi;
            iSector = 25 + nHoriAngl / (Math.PI / 12);
        }
        else if (coor[1] <= -Math.sin(Math.PI * 5 / 24))
            iSector = 217.0 - nHoriAngl / (Math.PI / 12);
        else if (coor[1] >= Math.sin(Math.PI / 8)) {
            if (nHoriAngl < 0)
                nHoriAngl += dWpi;
            iSector = 49 + nHoriAngl / (Math.PI / 15);
        }
        else if (coor[1] <= -Math.sin(Math.PI / 8))
            iSector = 190.0 - nHoriAngl / (Math.PI / 15);
        else if (coor[1] >= Math.sin(Math.PI / 24)) {
            if (nHoriAngl < 0)
                nHoriAngl += dWpi;
            iSector = (79 + nHoriAngl / (Math.PI / 16));
        }
        else if (coor[1] <= -Math.sin(Math.PI / 24))
            iSector = 159.0 - nHoriAngl / (Math.PI / 16);
        else if (nHoriAngl < 0)
            iSector = 127 - nHoriAngl / (Math.PI / 16);
        else {
            if (nHoriAngl == Math.PI)
                iSector = 142;
            else
                iSector = 111 + nHoriAngl / (Math.PI / 16);
        }
        return iSector;
    };

    /*
    /   Get weight value of the target direction
    */
    Sopa.prototype.polar = function (focus, target) {
        var weight;
        var angle;
        var dot;

        // dot product
        dot = target[0] * focus[0] + target[1] * focus[1] + target[2] * focus[2];

        angle = Math.acos(dot);     //  Angle (0 <= angle < PI)
        weight = (1 + Math.cos(angle)) / 2;
        return weight;
    };

};
