import type { HTMLAttributes } from "react"

const SAFARI_WIDTH = 1444
const SAFARI_HEIGHT = 904
const SCREEN_X = 1
const SCREEN_Y = 62
const SCREEN_WIDTH = 1440
const SCREEN_HEIGHT = 840

// Calculated percentages
const LEFT_PCT = (SCREEN_X / SAFARI_WIDTH) * 100
const TOP_PCT = (SCREEN_Y / SAFARI_HEIGHT) * 100
const WIDTH_PCT = (SCREEN_WIDTH / SAFARI_WIDTH) * 100
const HEIGHT_PCT = (SCREEN_HEIGHT / SAFARI_HEIGHT) * 100

type SafariMode = "default" | "simple"

export interface SafariProps extends HTMLAttributes<HTMLDivElement> {
  url?: string
  imageSrc?: string
  videoSrc?: string
  mode?: SafariMode
}

export function Safari({
  imageSrc,
  videoSrc,
  url,
  mode = "default",
  className,
  style,
  ...props
}: SafariProps) {
  const hasVideo = !!videoSrc
  const hasMedia = hasVideo || !!imageSrc

  return (
    <div
      className={`relative inline-block w-full align-middle leading-none ${className ?? ""}`}
      style={{
        aspectRatio: `${SAFARI_WIDTH}/${SAFARI_HEIGHT}`,
        ...style,
      }}
      {...props}
    >
      {hasVideo && (
        <div
          className="pointer-events-none absolute z-0 overflow-hidden"
          style={{
            left: `${LEFT_PCT}%`,
            top: `${TOP_PCT}%`,
            width: `${WIDTH_PCT}%`,
            height: `${HEIGHT_PCT}%`,
          }}
        >
          <video
            className="block size-full object-cover"
            src={videoSrc}
            autoPlay
            loop
            muted
            playsInline
            preload="metadata"
          />
        </div>
      )}

      {!hasVideo && imageSrc && (
        <div
          className="pointer-events-none absolute z-0 overflow-hidden"
          style={{
            left: `${LEFT_PCT}%`,
            top: `${TOP_PCT}%`,
            width: `${WIDTH_PCT}%`,
            height: `${HEIGHT_PCT}%`,
            borderRadius: "0 0 11px 11px",
          }}
        >
          <img
            src={imageSrc}
            alt=""
            className="block size-full object-cover object-top"
          />
        </div>
      )}

      <svg
        viewBox={`0 0 ${SAFARI_WIDTH} ${SAFARI_HEIGHT}`}
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="absolute inset-0 z-10 size-full"
        style={{ transform: "translateZ(0)" }}
      >
        <defs>
          <mask id="safariPunch" maskUnits="userSpaceOnUse">
            <rect
              x="0"
              y="0"
              width={SAFARI_WIDTH}
              height={SAFARI_HEIGHT}
              fill="white"
            />
            <path
              d="M1 62H1441V889C1441 896.49 1435.3 902 1428 902H14C6.7 902 1 896.49 1 889V62Z"
              fill="black"
            />
          </mask>

          <clipPath id="path0">
            <rect width={SAFARI_WIDTH} height={SAFARI_HEIGHT} fill="white" />
          </clipPath>

          <clipPath id="roundedBottom">
            <path
              d="M1 62H1441V889C1441 896.49 1435.3 902 1428 902H14C6.7 902 1 896.49 1 889V62Z"
              fill="white"
            />
          </clipPath>
        </defs>

        <g
          clipPath="url(#path0)"
          mask={hasMedia ? "url(#safariPunch)" : undefined}
        >
          <path
            d="M0 62H1442V889C1442 896.95 1436.36 904 1428 904H14C6.45 904 0 896.95 0 889V62Z"
            className="fill-[#E5E5E5] dark:fill-[#404040]"
          />
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M0 14C0 6.45 6.45 0 14 0H1428C1436 0 1442 6.45 1442 14V62H0L0 14Z"
            className="fill-[#E5E5E5] dark:fill-[#404040]"
          />
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M1.28 14C1.28 7.11 7.19 1.2 14.08 1.2H1427.92C1435.2 1.2 1441.12 7.11 1441.12 14V61H1.28V14Z"
            className="fill-white dark:fill-[#262626]"
          />
          <circle
            cx="32"
            cy="30"
            r="7"
            className="fill-[#E5E5E5] dark:fill-[#404040]"
          />
          <circle
            cx="56"
            cy="30"
            r="7"
            className="fill-[#E5E5E5] dark:fill-[#404040]"
          />
          <circle
            cx="80"
            cy="30"
            r="7"
            className="fill-[#E5E5E5] dark:fill-[#404040]"
          />
          <path
            d="M343 20C343 16.4 346.4 13 350 13H1135C1138.6 13 1142 16.4 1142 20V42C1142 45.6 1138.6 49 1135 49H350C346.4 49 343 45.6 343 42V20Z"
            className="fill-[#E5E5E5] dark:fill-[#404040]"
          />
          <g className="mix-blend-luminosity">
            <path
              d="M679.5 38.5H686.9C687.9 38.5 688.4 38 688.4 36.9V31.2C688.4 30.2 688 29.7 687.2 29.6V27.7C687.2 24.8 685.2 23.4 683.2 23.4C681.2 23.4 679.3 24.8 679.3 27.7V29.6C678.5 29.7 678 30.2 678 31.2V36.9C678 38 678.5 38.5 679.5 38.5ZM680.7 27.6C680.7 25.8 681.9 24.8 683.2 24.8C684.6 24.8 685.7 25.8 685.7 27.6V29.6L680.7 29.6V27.6Z"
              fill="#A3A3A3"
            />
          </g>

          <g className="mix-blend-luminosity">
            <text
              x="696"
              y="36"
              fill="#A3A3A3"
              fontSize="14"
              fontFamily="Arial, sans-serif"
            >
              {url}
            </text>
          </g>

          {mode === "default" ? (
            <>
              <g className="mix-blend-luminosity">
                <path
                  d="M318.6 40.7C318.8 40.7 319 40.6 319.3 40.5C325 37.6 326.5 36.2 326.5 32.8V25.7C326.5 24.6 326.1 24.2 325.2 23.8C324.1 23.3 320.6 22.1 319.6 21.8C319.3 21.7 318.9 21.6 318.6 21.6C318.3 21.6 317.9 21.7 317.6 21.8C316.6 22.1 313.1 23.3 312 23.8C311.1 24.2 310.7 24.6 310.7 25.7V32.8C310.7 36.2 312.6 37.5 317.9 40.5C318.2 40.6 318.4 40.7 318.6 40.7ZM319.1 23.5C320.3 24 323.4 24.9 324.4 25.4C324.7 25.5 324.7 25.7 324.7 26V32.4C324.7 35.2 323.4 35.9 319.1 38.5C318.9 38.6 318.7 38.7 318.6 38.7V23.4C318.7 23.4 318.9 23.4 319.1 23.5Z"
                  fill="#A3A3A3"
                />
              </g>
              <g className="mix-blend-luminosity">
                <path
                  d="M1123.5 30C1123.8 30 1124 29.9 1124.2 29.7L1128 25.8C1128.2 25.6 1128.3 25.4 1128.3 25.1C1128.3 24.9 1128.2 24.6 1128 24.5L1124.2 20.5C1124 20.4 1123.8 20.3 1123.5 20.3C1123 20.3 1122.6 20.7 1122.6 21.2C1122.6 21.5 1122.7 21.7 1122.9 21.8L1125.1 24C1124.7 24 1124.2 23.9 1123.8 23.9C1119.1 23.9 1115.4 27.6 1115.4 32.3C1115.4 37 1119.2 40.7 1123.8 40.7C1128.5 40.7 1132.2 37 1132.2 32.3C1132.2 31.7 1131.8 31.3 1131.2 31.3C1130.7 31.3 1130.3 31.7 1130.3 32.3C1130.3 35.9 1127.4 38.8 1123.8 38.8C1120.2 38.8 1117.3 35.9 1117.3 32.3C1117.3 28.6 1120.2 25.8 1123.8 25.8C1124.4 25.8 1125 25.8 1125.4 25.9L1122.9 28.4C1122.7 28.6 1122.6 28.8 1122.6 29.1C1122.6 29.6 1123 30 1123.5 30Z"
                  fill="#A3A3A3"
                />
              </g>
              <g className="mix-blend-luminosity">
                <path
                  d="M1361 39.6C1361.6 39.6 1362.3 39 1362.3 38.6V32.7H1367.6C1368.2 32.7 1368.6 32.2 1368.6 31.6C1368.6 31 1368.2 30.6 1367.6 30.6H1362.3V24.7C1362.3 24.1 1361.6 23.7 1361 23.7C1360.4 23.7 1359.7 24.1 1359.7 24.7V30.6H1354.4C1353.9 30.6 1353.4 31 1353.4 31.6C1353.4 32.2 1353.9 32.7 1354.4 32.7H1359.7V38.6C1359.7 39 1360.4 39.6 1361 39.6Z"
                  fill="#A3A3A3"
                />
              </g>
              <g className="mix-blend-luminosity">
                <path
                  d="M1394.2 37.3H1395.9V38.8C1395.9 40.9 1396.9 41.9 1398.9 41.9H1409C1411.1 41.9 1412.1 40.9 1412.1 38.8V28.9C1412.1 26.8 1411.1 25.8 1409 25.8H1407.3V24.3C1407.3 22.3 1406.3 21.2 1404.2 21.2H1394.2C1392.1 21.2 1391.1 22.3 1391.1 24.3V34.2C1391.1 36.2 1392.1 37.3 1394.2 37.3ZM1394.3 35.4C1393.4 35.4 1392.9 35 1392.9 34.1V24.5C1392.9 23.6 1393.4 23.1 1394.3 23.1H1404.1C1405 23.1 1405.4 23.6 1405.4 24.5V25.8H1398.9C1396.9 25.8 1395.9 26.8 1395.9 28.9V35.4H1394.3ZM1398.9 40C1398.2 40 1397.8 39.6 1397.8 38.7V29C1397.8 28.1 1398.2 27.7 1398.9 27.7H1408.9C1409.8 27.7 1410.2 28.1 1410.2 29V38.7C1410.2 39.6 1409.8 40 1408.9 40H1398.9Z"
                  fill="#A3A3A3"
                />
              </g>
              <g className="mix-blend-luminosity">
                <path
                  d="M1319.4 34.1C1319.9 34.1 1320.3 33.7 1320.3 33.2V23.8L1320.2 22.4L1320.8 23.1L1322.1 24.5C1322.3 24.7 1322.5 24.8 1322.7 24.8C1323.1 24.8 1323.5 24.4 1323.5 24C1323.5 23.8 1323.4 23.6 1323.2 23.4L1320.1 20.4C1319.9 20.2 1319.6 20.1 1319.4 20.1C1319.2 20.1 1318.9 20.2 1318.7 20.4L1315.6 23.4C1315.4 23.6 1315.3 23.8 1315.3 24C1315.3 24.4 1315.7 24.8 1316.1 24.8C1316.3 24.8 1316.6 24.7 1316.7 24.5L1318 23.1L1318.6 22.4L1318.5 23.8V33.2C1318.5 33.7 1318.9 34.1 1319.4 34.1ZM1314 41.6H1324.8C1326.8 41.6 1327.9 40.5 1327.9 38.5V29.3C1327.9 27.3 1326.8 26.2 1324.8 26.2H1322.3V28.1H1324.7C1325.5 28.1 1326 28.6 1326 29.5V38.4C1326 39.3 1325.5 39.7 1324.7 39.7H1314.1C1313.3 39.7 1312.8 39.3 1312.8 38.4V29.5C1312.8 28.6 1313.3 28.1 1314.1 28.1H1316.6V26.2H1314C1312 26.2 1310.9 27.3 1310.9 29.3V38.5C1310.9 40.5 1312 41.6 1314 41.6Z"
                  fill="#A3A3A3"
                />
              </g>
              <g className="mix-blend-luminosity">
                <path
                  d="M119.5 40.3H135.5C137.6 40.3 138.6 39.3 138.6 37.3V25.9C138.6 23.8 137.6 22.8 135.5 22.8H119.5C117.5 22.8 116.4 23.9 116.4 25.9V37.3C116.4 39.3 117.5 40.3 119.5 40.3ZM119.6 38.5C118.7 38.5 118.3 38 118.3 37.1V26C118.3 25.1 118.7 24.7 119.6 24.7H123.9V38.5H119.6ZM135.4 24.7C136.3 24.7 136.7 25.1 136.7 26V37.1C136.7 38 136.3 38.5 135.4 38.5H125.7V24.7H135.4ZM122 28.1C122.4 28.1 122.7 27.8 122.7 27.5C122.7 27.2 122.4 26.9 122 26.9H120.1C119.8 26.9 119.5 27.2 119.5 27.5C119.5 27.8 119.8 28.1 120.1 28.1H122ZM122 30.6C122.4 30.6 122.7 30.3 122.7 30C122.7 29.7 122.4 29.4 122 29.4H120.1C119.8 29.4 119.5 29.7 119.5 30C119.5 30.3 119.8 30.6 120.1 30.6H122ZM122 33.1C122.4 33.1 122.7 32.9 122.7 32.5C122.7 32.2 122.4 31.9 122 31.9H120.1C119.8 31.9 119.5 32.2 119.5 32.5C119.5 32.9 119.8 33.1 120.1 33.1H122Z"
                  fill="#A3A3A3"
                />
              </g>
              <g className="mix-blend-luminosity">
                <path
                  d="M172.7 39.1C172.9 39.3 173.2 39.4 173.5 39.4C174.1 39.4 174.6 39 174.6 38.3C174.6 38 174.5 37.7 174.3 37.5L167.7 31.1L174.3 24.7C174.5 24.5 174.6 24.2 174.6 23.9C174.6 23.3 174.1 22.8 173.5 22.8C173.2 22.8 172.9 22.9 172.7 23.1L165.4 30.2C165.1 30.5 165 30.8 165 31.1C165 31.4 165.1 31.7 165.4 31.9L172.7 39.1Z"
                  fill="#A3A3A3"
                />
              </g>
              <g className="mix-blend-luminosity">
                <path
                  d="M202.1 39.4C202.4 39.4 202.7 39.3 202.9 39.1L210.2 32C210.4 31.7 210.6 31.4 210.6 31.1C210.6 30.8 210.4 30.5 210.2 30.2L202.9 23.1C202.7 22.9 202.4 22.8 202.1 22.8C201.5 22.8 201 23.3 201 23.9C201 24.2 201.1 24.5 201.3 24.7L207.9 31.1L201.3 37.5C201.1 37.7 201 38 201 38.3C201 39 201.5 39.4 202.1 39.4Z"
                  fill="#A3A3A3"
                />
              </g>
            </>
          ) : null}
        </g>
      </svg>
    </div>
  )
}