package com.camlens.app;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.ServerSocket;
import java.net.Socket;
import java.util.Collections;
import java.util.HashSet;
import java.util.Set;

public class StreamServer {
    private final int port;
    private final MainActivity activity;
    private ServerSocket serverSocket;
    private boolean isRunning = false;
    private byte[] latestFrame = null;
    private long frameVersion = 0;
    private final Object frameLock = new Object();

    public StreamServer(int port, MainActivity activity) {
        this.port = port;
        this.activity = activity;
    }

    public void start() {
        isRunning = true;
        new Thread(() -> {
            try {
                serverSocket = new ServerSocket(port);
                while (isRunning) {
                    Socket socket = serverSocket.accept();
                    new Thread(() -> handleClient(socket)).start();
                }
            } catch (IOException e) {
                e.printStackTrace();
            }
        }).start();
    }

    public void stop() {
        isRunning = false;
        synchronized (frameLock) {
            frameLock.notifyAll();
        }
        try {
            if (serverSocket != null) {
                serverSocket.close();
            }
        } catch (IOException ignored) {}
    }

    public void updateFrame(byte[] jpegBytes) {
        synchronized (frameLock) {
            this.latestFrame = jpegBytes;
            this.frameVersion++;
            frameLock.notifyAll();
        }
    }

    private void handleClient(Socket socket) {
        try {
            socket.setTcpNoDelay(true);
            socket.setSendBufferSize(64 * 1024);

            InputStream in = socket.getInputStream();
            OutputStream out = socket.getOutputStream();

            byte[] buffer = new byte[2048];
            int read = in.read(buffer);
            if (read <= 0) {
                socket.close();
                return;
            }

            String request = new String(buffer, 0, read);
            String[] lines = request.split("\r\n");
            if (lines.length == 0) {
                socket.close();
                return;
            }

            String firstLine = lines[0];
            String[] parts = firstLine.split(" ");
            if (parts.length < 2) {
                socket.close();
                return;
            }

            String path = parts[1];

            // CORS headers
            String cors = "Access-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\n";

            if (path.startsWith("/flip")) {
                activity.runOnUiThread(activity::flipCamera);
                String resp = "HTTP/1.1 200 OK\r\n" + cors + "Content-Type: application/json\r\n\r\n{\"success\":true}";
                out.write(resp.getBytes());
                out.flush();
                socket.close();
                return;
            }

            if (path.startsWith("/torch")) {
                activity.runOnUiThread(activity::toggleTorch);
                String resp = "HTTP/1.1 200 OK\r\n" + cors + "Content-Type: application/json\r\n\r\n{\"success\":true}";
                out.write(resp.getBytes());
                out.flush();
                socket.close();
                return;
            }

            if (path.startsWith("/photo.jpg")) {
                byte[] frameCopy = null;
                synchronized (frameLock) {
                    if (latestFrame != null) {
                        frameCopy = latestFrame;
                    }
                }
                if (frameCopy != null) {
                    String header = "HTTP/1.1 200 OK\r\n" + cors +
                            "Content-Type: image/jpeg\r\n" +
                            "Content-Length: " + frameCopy.length + "\r\n\r\n";
                    out.write(header.getBytes());
                    out.write(frameCopy);
                    out.flush();
                } else {
                    out.write(("HTTP/1.1 404 Not Found\r\n" + cors + "\r\n").getBytes());
                    out.flush();
                }
                socket.close();
                return;
            }

            if (path.startsWith("/stream") || path.startsWith("/video")) {
                // MJPEG stream: RFC 2046 compliant boundary for Chrome/Chromium
                String mjpegHeader = "HTTP/1.1 200 OK\r\n" +
                        cors +
                        "Cache-Control: no-cache, no-store, must-revalidate\r\n" +
                        "Pragma: no-cache\r\n" +
                        "Expires: 0\r\n" +
                        "Connection: close\r\n" +
                        "Content-Type: multipart/x-mixed-replace; boundary=frame\r\n\r\n";
                out.write(mjpegHeader.getBytes());
                out.flush();

                long lastSentVersion = -1;
                while (isRunning && !socket.isClosed()) {
                    byte[] current;
                    synchronized (frameLock) {
                        while (isRunning && !socket.isClosed() && (latestFrame == null || frameVersion == lastSentVersion)) {
                            frameLock.wait(100);
                        }
                        if (!isRunning || socket.isClosed()) break;
                        current = latestFrame;
                        lastSentVersion = frameVersion;
                    }

                    if (current != null) {
                        String frameHeader = "--frame\r\n" +
                                "Content-Type: image/jpeg\r\n" +
                                "Content-Length: " + current.length + "\r\n\r\n";
                        out.write(frameHeader.getBytes());
                        out.write(current);
                        out.write("\r\n".getBytes());
                        out.flush();
                    }
                }
                return;
            }

            // Default Status Response
            String json = "{\"app\":\"CamLens\",\"version\":\"1.0\",\"status\":\"ready\"}";
            String resp = "HTTP/1.1 200 OK\r\n" + cors +
                    "Content-Type: application/json\r\n" +
                    "Content-Length: " + json.length() + "\r\n\r\n" + json;
            out.write(resp.getBytes());
            out.flush();
            socket.close();

        } catch (Exception e) {
            try {
                socket.close();
            } catch (IOException ignored) {}
        }
    }
}
