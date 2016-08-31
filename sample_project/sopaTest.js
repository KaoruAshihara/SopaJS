// sopaTest.js version 1.0

// JavaScript source code for reproducing a SOPA file
// Created by Kaoru Ashihara
// Copyright (c) 2016 AIST

var sopaTest = (function () {
    var sopa;       // SOPA instance
    var isStarted = false;
    var isPlay;
    var isFirstPlay = true;
    var anglHor = 0;   // Horizontal angle (pan)
    var anglVer = 0;    // Vertical angle (tilt); not used
    var toggle = 0;     // Directionality factor 0; Omni, 1; Cardioid, 2; Cardioid^2
    var msgElem = document.getElementById("message");
    var leftElem = document.getElementById("left");
    var rightElem = document.getElementById("right");
    var playElem = document.getElementById("play");
    var cardioidElem = document.getElementById("cardioid");

    function sopaTest() {
        var sopaElem = document.getElementById("sopaUrl");
        sopa = new Sopa(sopaElem.innerHTML);    // Constructor of a SOPA instance

        this.init();
    }

    sopaTest.prototype.init = function () {
        var that = this;
        var hrtf_element = document.getElementById("hrtfUrl");
        var hrtfStr = hrtf_element.innerHTML;   // Location of hrtf3d512.bin
        var phase_element = document.getElementById("phaseUrl");
        var phaseStr = phase_element.innerHTML; // location of phase3d512.bin
        var focusHor = 0 * Math.PI / 180;
        var focusVer = 0 * Math.PI / 180;
        sopa.setCardioid(toggle, focusHor, focusVer);	// toggle is 0
        sopa.loadDatabase(hrtfStr,phaseStr);    // Load HRTF databases
        sopa.loadSopaData();                    // Load SOPA data

        leftElem.addEventListener('click', function () {
            var target = document.getElementById("pan");
            anglHor = parseInt(target.innerHTML);   // Horizontal angle in degree
            anglHor += 5;                           // Pan to the left by 5 degrees
            if (anglHor > 179)
                anglHor -= 360;
            sopa.setPan(anglHor);                   // Set a pan value of the SOPA instance
            target.innerHTML = "" + anglHor;        // Updata the value on the Web page
            if (anglHor != 0)
                document.getElementById("degree").innerHTML = "degrees";
            else
                document.getElementById("degree").innerHTML = "degree";
        }, false);
        rightElem.addEventListener('click', function () {
            var target = document.getElementById("pan");
            anglHor = parseInt(target.innerHTML);
            anglHor -= 5;                           // Pan to the right by 5 degrees
            if (anglHor < -180)
                anglHor += 360;
            sopa.setPan(anglHor);
            target.innerHTML = "" + anglHor;
            if (anglHor != 0)
                document.getElementById("degree").innerHTML = "degrees";
            else
                document.getElementById("degree").innerHTML = "degree";
        }, false);

        playElem.addEventListener('click', function () {
            var tap;
            if (isStarted == false) {
                if (isFirstPlay) {
                    if (sopa.setup()) {
                        isStarted = true;
                        isFirstPlay = false;
                        playElem.innerHTML = "STOP";
                        sopa.Play();    // Start reproduction
                    }
                }
                else {
                    isStarted = true;
                    playElem.innerHTML = "STOP";
                    sopa.Play();    // Start reproduction
                }
            }
            else {
                isStarted = false;
                playElem.innerHTML = "PLAY";
                sopa.Play();    // Stop reproduction
            }
        }, false);
        
        cardioidElem.addEventListener('click', function () {
            var focusHor = 0 * Math.PI / 180;
            var focusVer = 0 * Math.PI / 180;
            toggle++;
            if (toggle > 2)
                toggle = 0;
            sopa.setCardioid(toggle, focusHor, focusVer);
            if (toggle == 0)
                cardioidElem.innerHTML = "OMNIDIRECTIONAL";
            else if (toggle == 1)
                cardioidElem.innerHTML = "CARDIOID IS ON";
            else
                cardioidElem.innerHTML = "CARDIOID<sup>2</sup> IS ON";
        }, false);

        setInterval(function () {
            var fsize = sopa.fftWinSize();
            if (sopa.beingPlayed()) {
                msgElem.innerHTML = "Click 'STOP' to stop reproduction";
            }
            else if(fsize > 0 && (fsize & (fsize - 1)) == 0 && sopa.databaseReady()){
                isStarted = false;
                playElem.innerHTML = "PLAY";
                playElem.disabled = false;
                msgElem.innerHTML = "Click 'PLAY' to start reproduction";
            }
        }, 500);    
    };

    return (sopaTest);
})();

window.onload = function () {
    new sopaTest();
};